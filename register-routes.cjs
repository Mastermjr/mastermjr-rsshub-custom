/**
 * register-routes.cjs
 * Patches RSSHub's pre-built routes.js to register custom routes at Docker build time.
 * Custom routes use inline types and native fetch — no @/ imports needed.
 *
 * @decision DEC-ROUTES-001
 * @title Build-time route injection via routes.js patching
 * @status accepted
 * @rationale RSSHub production mode loads from assets/build/routes.js (pre-built static).
 *   Custom .ts routes in lib/routes/ are never discovered. This script patches routes.js
 *   and copies route files to /app/custom-routes/ for Node 24 native TS strip-types.
 */
const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
const ROUTES_JS = path.join(APP_DIR, 'assets', 'build', 'routes.js');
const CUSTOM_SRC = path.join(APP_DIR, 'lib', 'routes');
const CUSTOM_DEST = path.join(APP_DIR, 'custom-routes');

if (!fs.existsSync(ROUTES_JS)) {
    console.warn('[register-routes] routes.js not found at', ROUTES_JS);
    return;
}
if (!fs.existsSync(CUSTOM_SRC)) {
    console.warn('[register-routes] No custom routes dir at', CUSTOM_SRC);
    return;
}

const namespaces = fs.readdirSync(CUSTOM_SRC, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

if (!namespaces.length) {
    console.log('[register-routes] No custom namespaces found');
    return;
}

fs.mkdirSync(CUSTOM_DEST, { recursive: true });
let routesContent = fs.readFileSync(ROUTES_JS, 'utf-8');

for (const ns of namespaces) {
    const srcDir = path.join(CUSTOM_SRC, ns);
    const destDir = path.join(CUSTOM_DEST, ns);
    fs.mkdirSync(destDir, { recursive: true });

    // Read namespace name
    let nsName = ns;
    const nsFile = path.join(srcDir, 'namespace.ts');
    if (fs.existsSync(nsFile)) {
        const nsContent = fs.readFileSync(nsFile, 'utf-8');
        const m = nsContent.match(/name:\s*['"]([^'"]+)['"]/);
        if (m) nsName = m[1];
        fs.copyFileSync(nsFile, path.join(destDir, 'namespace.ts'));
    }

    // Copy and register route files
    const routeFiles = fs.readdirSync(srcDir)
        .filter(f => f.endsWith('.ts') && f !== 'namespace.ts');

    const routes = {};
    for (const file of routeFiles) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');

        const pathMatch = content.match(/path:\s*['"]([^'"]+)['"]/);
        if (!pathMatch) continue;

        const nameMatch = content.match(/^\s*name:\s*['"]([^'"]+)['"]/m);
        const exampleMatch = content.match(/example:\s*['"]([^'"]+)['"]/);
        const maintainersMatch = content.match(/maintainers:\s*\[([^\]]+)\]/);

        routes[pathMatch[1]] = {
            path: pathMatch[1],
            name: nameMatch ? nameMatch[1] : file.replace('.ts', ''),
            maintainers: maintainersMatch
                ? maintainersMatch[1].match(/['"]([^'"]+)['"]/g)?.map(s => s.replace(/['"]/g, '')) || ['mastermjr']
                : ['mastermjr'],
            location: file,
            example: exampleMatch ? exampleMatch[1] : `/${ns}${pathMatch[1]}`,
            categories: ['other'],
            features: { requireConfig: false, requirePuppeteer: false, antiCrawler: false },
        };
    }

    if (!Object.keys(routes).length) continue;

    const routeEntries = Object.entries(routes).map(([rPath, rData]) => {
        const abs = path.join(destDir, rData.location).replace(/\\/g, '/');
        return `${JSON.stringify(rPath)}: Object.assign(${JSON.stringify(rData)}, { module: () => import("${abs}") })`;
    });

    const nsEntry = `"${ns}": {
    "name": ${JSON.stringify(nsName)},
    "routes": { ${routeEntries.join(',\n    ')} },
    "apiRoutes": {}
  }`;

    const lastBrace = routesContent.lastIndexOf('}');
    if (lastBrace === -1) { console.warn('[register-routes] No injection point'); continue; }
    const before = routesContent.substring(0, lastBrace).trimEnd();
    const comma = before.endsWith('}') || before.endsWith('"') || before.endsWith(')');
    routesContent = before + (comma ? ',\n  ' : '\n  ') + nsEntry + '\n}';
    console.log(`[register-routes] Registered: ${ns} (${Object.keys(routes).length} routes)`);
}

fs.writeFileSync(ROUTES_JS, routesContent);
console.log('[register-routes] Done.');
