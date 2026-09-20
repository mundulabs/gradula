/** Compiler-resolved JS/TS relationships. The host can see only supplied files. */
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {normalizeGraph} from '../src/codegraph.mjs';

export const GENERATOR = `gradula-typescript/2:typescript-${ts.version}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const root = '/graph/';
const fileId = path => `file:${path}`;
const lineAt = (ast, offset) => ast.getLineAndCharacterOfPosition(offset).line + 1;
const named = node => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null;
const isFunction = node => ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

export function createIndexer({granularity='symbols'}={}) {
  if (!['symbols','files'].includes(granularity)) throw new Error('Granularity must be symbols or files');
  let cache = new Map(), previousProgram;
  return {
    build(files, metadata) {
      const nodes = [], edges = [], sources = new Map(), next = new Map(), ids = new Set(), definitions = new Map();
      const stats = {files:files.size, parsed:0, reused:0, deleted:[...cache.keys()].filter(path=>!files.has(path)).length, unresolvedCalls:0};
      const add = node => { if (ids.has(node.id)) return false; ids.add(node.id); nodes.push(node); return true; };
      const edgeKeys = new Set();
      const edge = (from,to,kind,path,line,reason) => {
        const key = JSON.stringify([from,to,kind,path,line]);
        if (from===to || edgeKeys.has(key)) return;
        edgeKeys.add(key); edges.push({from,to,kind,confidence:'EXTRACTED',reason,source:{path,line}});
      };
      for (const [path,source] of [...files].sort(([a],[b])=>a.localeCompare(b))) {
        const contentHash = hash(source), old = cache.get(path);
        let ast = old?.hash===contentHash ? old.ast : null;
        if (old?.hash===contentHash) stats.reused++; else stats.parsed++;
        if (!path.endsWith('.md') && !ast) ast = ts.createSourceFile(root+path,source,ts.ScriptTarget.Latest,true);
        if (ast?.parseDiagnostics.length) throw new Error(`Cannot index invalid syntax in ${path}`);
        next.set(path,{hash:contentHash,ast});
        if (ast) sources.set(root+path,ast);
        const header = source.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1]?.replace(/^\s*\* ?/gm,'').trim() ?? '';
        add({id:fileId(path),name:posix.basename(path),kind:ast?'file':'document',path,line:1,endLine:source.split('\n').length,contentHash,area:path.split('/')[0],about:(ast?header:source.replace(/\s+/g,' ')).slice(0,1800)});
        if (!ast) {
          for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
            const name = match[1].trim(), line = source.slice(0,match.index).split('\n').length;
            const id = `${fileId(path)}#heading:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-')}`;
            const body = source.slice(match.index).split(/\n(?=#{1,6}\s)/)[0];
            if (add({id,name,kind:'section',path,line,endLine:line+body.split('\n').length-1,contentHash,about:body.replace(/\s+/g,' ').slice(0,2500)})) edge(fileId(path),id,'contains',path,line,'Markdown section at this source range');
          }
          continue;
        }
        const declare = (node,scope=[]) => {
          const name = named(node);
          const variable = ts.isVariableDeclaration(node) && (ts.isVariableStatement(node.parent?.parent) && ts.isSourceFile(node.parent.parent.parent) || node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)));
          const property = ts.isPropertyAssignment(node) && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
          const eligible = name && (isFunction(node) || variable || property || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node));
          let childScope = scope;
          if (eligible) {
            const base = `${fileId(path)}#${[...scope,name].join('.')}`;
            let id = base, suffix=2;
            while (ids.has(id)) id = `${base}:${suffix++}`;
            const docs = (node.jsDoc ?? node.parent?.parent?.jsDoc ?? []).map(doc=>doc.getText(ast)).join(' ').replace(/\s+/g,' ');
            const signature = node.getText(ast).split(/[\n{]/)[0].slice(0,240);
            add({id,name,kind:'symbol',path,line:lineAt(ast,node.getStart(ast)),endLine:lineAt(ast,node.end),contentHash,area:path.split('/')[0],about:`${docs} ${signature}`.trim().slice(0,1800)});
            definitions.set(node,id);
            edge(fileId(path),id,'declares',path,lineAt(ast,node.getStart(ast)),'Named declaration in the syntax tree');
            childScope = [...scope,name];
          }
          ts.forEachChild(node,child=>declare(child,childScope));
        };
        declare(ast);
        const declared=nodes.filter(n=>n.path===path && n.kind==='symbol').map(n=>n.name);
        nodes.find(n=>n.id===fileId(path)).about = `${header} Declarations: ${declared.join(' ')}`.slice(0,6000);
      }
      const options = {allowJs:true,checkJs:true,noLib:true,noEmit:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.Latest};
      const directories = new Set(['/graph']);
      for (const path of sources.keys()) { let dir=posix.dirname(path); while (dir!=='/') {directories.add(dir);dir=posix.dirname(dir);} }
      const host = {
        getSourceFile:path=>sources.get(path), getDefaultLibFileName:()=>'', writeFile:()=>{},
        getCurrentDirectory:()=>'/graph', getDirectories:()=>[], directoryExists:path=>directories.has(path),
        fileExists:path=>sources.has(path), readFile:path=>sources.get(path)?.text,
        getCanonicalFileName:path=>path, useCaseSensitiveFileNames:()=>true, getNewLine:()=> '\n',
      };
      const program = ts.createProgram({rootNames:[...sources.keys()],options,host,oldProgram:previousProgram});
      const checker = program.getTypeChecker();
      const targetOf = expression => {
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression)?expression.name:expression);
        const seen = new Set();
        while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) { seen.add(symbol);symbol=checker.getAliasedSymbol(symbol); }
        return symbol?.declarations?.map(d=>definitions.get(d)).find(Boolean);
      };
      for (const [path,source] of files) {
        const ast = sources.get(root+path);
        if (!ast) {
          for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)#]+)(?:#[^)]*)?\)|`([^`\n]+)`/g)) {
            const target = match[1] ? posix.normalize(posix.join(posix.dirname(path),match[1])) : match[2];
            if (files.has(target)) edge(fileId(path),fileId(target),'references',path,source.slice(0,match.index).split('\n').length,'Explicit document path reference');
          }
          continue;
        }
        const visit = (node,owner=fileId(path)) => {
          owner = definitions.get(node) ?? owner;
          const module = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
            : ts.isCallExpression(node) && (node.expression.kind===ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text==='require') ? node.arguments[0] : null;
          if (module && ts.isStringLiteral(module)) {
            const resolved = ts.resolveModuleName(module.text,root+path,options,host).resolvedModule?.resolvedFileName;
            const target = resolved?.startsWith(root) ? resolved.slice(root.length) : null;
            if (target && files.has(target)) {
              edge(fileId(path),fileId(target),'imports',path,lineAt(ast,node.getStart(ast)),'Compiler-resolved literal module reference');
              if (/(?:^|\/)tests?\//.test(path) || /\.test\./.test(path)) edge(fileId(path),fileId(target),'tests',path,lineAt(ast,node.getStart(ast)),'Test file imports this module; this does not assert a passing test');
            }
          }
          if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            const target = targetOf(node.expression);
            if (target) edge(owner,target,ts.isNewExpression(node)?'constructs':'calls',path,lineAt(ast,node.getStart(ast)),'Target declaration resolved by the TypeScript checker; static reference, not runtime proof');
            else if (!module) stats.unresolvedCalls++;
          }
          if (ts.isHeritageClause(node)) for (const type of node.types) {
            const target = targetOf(type.expression);
            if (target) edge(owner,target,'extends',path,lineAt(ast,node.getStart(ast)),'Compiler-resolved heritage reference');
          }
          ts.forEachChild(node,child=>visit(child,owner));
        };
        visit(ast);
      }
      edges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const projected = granularity==='files' ? fileGraph(nodes,edges) : {nodes,edges};
      const scope = granularity==='files'
        ? 'file-level JS/TS/Markdown; representative cross-file edges; symbol details omitted; NodeNext'
        : 'tracked JavaScript, TypeScript and Markdown; NodeNext resolution';
      const graph = normalizeGraph({schema:'gradula.codegraph.v1',...metadata,generator:`${GENERATOR}/${granularity}`,coverage:{files:files.size,unresolvedCalls:stats.unresolvedCalls,scope},...projected},metadata.repository);
      // A failed parse/admission never poisons the previous successful cache.
      cache=next;previousProgram=program;
      return {graph,stats};
    },
  };
}

export const buildGraph = (files,metadata) => createIndexer().build(files,metadata).graph;

/** One node for every input file, one representative source for each typed file relationship. */
function fileGraph(nodes,edges) {
  const paths=new Map(nodes.map(node=>[node.id,node.path]));
  const files=nodes.filter(node=>node.kind==='file'||node.kind==='document').map(node=>({...node,about:node.about.slice(0,1200)}));
  const relationships=new Map();
  for(const edge of edges) {
    const from=fileId(paths.get(edge.from)),to=fileId(paths.get(edge.to));
    if(from===to)continue;
    const key=JSON.stringify([from,to,edge.kind]);
    // Input edges are sorted, so this representative is stable across input order.
    if(!relationships.has(key))relationships.set(key,{...edge,from,to,reason:`Representative file relationship: ${edge.kind}. Read source for symbol detail.`});
  }
  return {nodes:files,edges:[...relationships.values()]};
}
