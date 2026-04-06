/**
 * register-routes.cjs
 * Patches RSSHub's pre-built routes.js to register custom routes at container startup.
 * Copies custom .ts routes into dist/routes/ with @/ imports rewritten to relative paths.
 *
 * @decision DEC-ROUTES-001
 * @title Runtime route injection via routes.js patching
 * @status accepted
 * @rationale RSSHub production mode loads routes from assets/build/routes.js, not filesystem.
 *   This script patches routes.js at build time and copies route files to dist/routes/
 *   with import aliases resolved, enabling Node 24's native TS strip-types to handle them.
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');
const ROUTES_JS = path.join(DIST_DIR, 'assets', 'build', 'routes.js');
const CUSTOM_ROUTES_DIR = path.join(__dirname, 'lib', 'routes');
const DIST_ROUTES_DIR = path.join(DIST_DIR, 'routes');

if (!fs.existsSync(ROUTES_JS)) {
    console.warn('[register-routes] routes.js not found at', ROUTES_JS);
    return;
}
if (!fs.existsSync(CUSTOM_ROUTES_DIR)) {
    console.warn('[register-routes] No custom routes dir at', CUSTOM_ROUTES_DIR);
    return;
}

const namespaces = fs.readdirSync(CUSTOM_ROUTES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

if (!namespaces.length) {
    console.log('[register-routes] No custom namespaces found');
    return;
}

let routesContent = fs.readFileSync(ROUTES_JS, 'utf-8');

for (const ns of namespaces) {
    const nsDir = path.join(CUSTOM_ROUTES_DIR, ns);
    const distNsDir = path.join(DIST_ROUTES_DIR, ns);

    // Create dist/routes/<ns>/
    fs.mkdirSync(distNsDir, { recursive: true });

    // Read namespace.ts for name
    let nsName = ns;
    const nsFile = path.join(nsDir, 'namespace.ts');
    if (fs.existsSync(nsFile)) {
        const nsContent = fs.readFileSync(nsFile, 'utf-8');
        const nameMatch = nsContent.match(/name:\s*['"]([^'"]+)['"]/);
        if (nameMatch) nsName = nameMatch[1];
        // Copy namespace file too, rewriting @/ imports
        const rewritten = rewriteImports(nsContent, ns);
        fs.writeFileSync(path.join(distNsDir, 'namespace.ts'), rewritten);
    }

    // Find route files (not namespace.ts)
    const routeFiles = fs.readdirSync(nsDir)
        .filter(f => f.endsWith('.ts') && f !== 'namespace.ts');

    const routes = {};
    for (const file of routeFiles) {
        const content = fs.readFileSync(path.join(nsDir, file), 'utf-8');

        // Copy to dist/routes/<ns>/ with @/ imports rewritten
        const rewritten = rewriteImports(content, ns);
        fs.writeFileSync(path.join(distNsDir, file), rewritten);

        // Extract path from route definition
        const pathMatch = content.match(/path:\s*['"]([^'"]+)['"]/);
        if (!pathMatch) continue;
        const routePath = pathMatch[1];

        // Extract metadata
        const nameMatch = content.match(/^\s*name:\s*['"]([^'"]+)['"]/m);
        const exampleMatch = content.match(/example:\s*['"]([^'"]+)['"]/);
        const maintainersMatch = content.match(/maintainers:\s*\[([^\]]+)\]/);

        routes[routePath] = {
            path: routePath,
            name: nameMatch ? nameMatch[1] : file.replace('.ts', ''),
            maintainers: maintainersMatch
                ? maintainersMatch[1].match(/['"]([^'"]+)['"]/g)?.map(s => s.replace(/['"]/g, '')) || ['mastermjr']
                : ['mastermjr'],
            location: file,
            example: exampleMatch ? exampleMatch[1] : `/${ns}${routePath}`,
            categories: ['other'],
            features: { requireConfig: false, requirePuppeteer: false, antiCrawler: false },
        };
    }

    if (!Object.keys(routes).length) continue;

    // Build the namespace entry for routes.js
    // The module() functions use dynamic import to load from dist/routes/
    const routeEntries = Object.entries(routes).map(([rPath, rData]) => {
        const importPath = path.join(distNsDir, rData.location).replace(/\\/g, '/');
        const meta = JSON.stringify(rData);
        return `${JSON.stringify(rPath)}: Object.assign(${meta}, { module: () => import("${importPath}") })`;
    });

    const nsEntry = `"${ns}": {
    "name": ${JSON.stringify(nsName)},
    "routes": { ${routeEntries.join(',\n    ')} },
    "apiRoutes": {}
  }`;

    // Inject before the closing of the default export object
    const lastBrace = routesContent.lastIndexOf('}');
    if (lastBrace === -1) {
        console.warn(`[register-routes] Could not find injection point in routes.js`);
        continue;
    }

    const beforeBrace = routesContent.substring(0, lastBrace).trimEnd();
    const needsComma = beforeBrace.endsWith('}') || beforeBrace.endsWith('"') || beforeBrace.endsWith(')');
    routesContent = beforeBrace + (needsComma ? ',\n  ' : '\n  ') + nsEntry + '\n}';
    console.log(`[register-routes] Registered namespace: ${ns} (${Object.keys(routes).length} routes)`);
}

fs.writeFileSync(ROUTES_JS, routesContent);
console.log('[register-routes] Done. Custom routes patched into routes.js');

/**
 * Rewrite @/ imports to relative paths pointing to dist/
 * e.g. `import { Route } from '@/types'` → `import { Route } from '../../types.js'`
 * The dist/ directory has the compiled RSSHub modules.
 */
function rewriteImports(source, namespace) {
    // @/ maps to dist/ in the built image
    // From dist/routes/<ns>/file.ts, the relative path to dist/ is ../../
    return source.replace(
        /from\s+['"]@\/([^'"]+)['"]/g,
        (match, importPath) => {
            // Check if the target exists as .mjs in dist/
            const candidate = path.join(DIST_DIR, importPath);
            if (fs.existsSync(candidate + '.mjs')) {
                return `from '../../${importPath}.mjs'`;
            }
            if (fs.existsSync(candidate + '.js')) {
                return `from '../../${importPath}.js'`;
            }
            if (fs.existsSync(candidate + '/index.mjs')) {
                return `from '../../${importPath}/index.mjs'`;
            }
            // Fallback: try without extension (Node may resolve it)
            return `from '../../${importPath}'`;
        }
    );
}
