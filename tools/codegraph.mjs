/** This project's local publisher. Code is parsed with the existing TypeScript compiler. */
import ts from 'typescript';
import {readFileSync, lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {posix, join} from 'node:path';
import {normalizeGraph} from '../src/codegraph.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();

export function buildGraph(files, {repository, revision, dirty}) {
  const nodes = [], edges = [];
  const id = path => `file:${path}`;
  const sourceLine = (source, offset) => source.slice(0, offset).split('\n').length;
  const connect = (from, to, kind, path, line, reason) => edges.push({from,to,kind,confidence:'EXTRACTED',reason,source:{path,line}});
  const resolveFile = (from, target) => {
    if (!target.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(from), target));
    return [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`].find(path => files.has(path)) ?? null;
  };
  for (const [path, source] of [...files].sort(([a],[b])=>a.localeCompare(b))) {
    const doc = path.endsWith('.md');
    const firstComment = source.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1]?.replace(/^\s*\* ?/gm, '').trim();
    nodes.push({id:id(path), name:posix.basename(path), path, kind:doc?'document':'file', area:path.split('/')[0],
      about:(doc ? source.replace(/^#+ /gm, '').replace(/\s+/g,' ') : firstComment || '').slice(0,600)});
    if (doc) {
      for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)#]+)(?:#[^)]*)?\)|`([^`\n]+)`/g)) {
        const target = match[1] ? resolveFile(path, match[1].startsWith('.')?match[1]:`./${match[1]}`) : files.has(match[2]) ? match[2] : null;
        if (target) connect(id(path),id(target),'references',path,sourceLine(source,match.index),'Explicit document path reference');
      }
      continue;
    }
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) throw new Error(`Cannot index invalid syntax in ${path}`);
    const visit = node => {
      const module = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : null;
      if (module && ts.isStringLiteral(module)) {
        const target = resolveFile(path,module.text);
        if (target) connect(id(path),id(target),'imports',path,ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,'Literal relative module reference in the syntax tree');
      }
      ts.forEachChild(node,visit);
    };
    visit(ast);
    for (const statement of ast.statements) {
      const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
      for (const declaration of declarations) {
        if (!declaration.name || !ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const symbol = `${id(path)}#${name}`;
        if (nodes.some(n=>n.id===symbol)) continue;
        nodes.push({id:symbol,name,path,line:ast.getLineAndCharacterOfPosition(declaration.getStart(ast)).line+1,kind:'symbol',area:path.split('/')[0],about:`Top-level declaration in ${path}`});
        connect(id(path),symbol,'declares',path,ast.getLineAndCharacterOfPosition(declaration.getStart(ast)).line+1,'Top-level named declaration in the syntax tree');
      }
    }
  }
  return normalizeGraph({schema:'gradula.codegraph.v1',repository,revision,dirty,nodes,edges},repository);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Only tracked code/docs in THIS repository, never env files, lockfiles or another checkout.
  const tracked = git('ls-files','-z').split('\0').filter(path => /\.(?:mjs|[jt]sx?|md)$/.test(path));
  const files = new Map(tracked.filter(path=>lstatSync(join(root,path)).isFile()).map(path=>[path,readFileSync(join(root,path),'utf8')]));
  const pkg = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const repository = pkg.repository.url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  const graph = buildGraph(files,{repository,revision:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain')});
  process.stdout.write(`${JSON.stringify(graph)}\n`);
}
