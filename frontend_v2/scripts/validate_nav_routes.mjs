import fs from "node:fs/promises"
import path from "node:path"

const projectRoot = path.resolve(process.cwd())
const appRoot = path.join(projectRoot, "src", "app")
const sidebarPath = path.join(projectRoot, "src", "components", "layout", "sidebar.tsx")
const sidebarNavPath = path.join(projectRoot, "src", "lib", "sidebar-nav.ts")
const navigationRoutesPath = path.join(projectRoot, "src", "lib", "navigation-routes.ts")

const PARENT_ROUTE_FALLBACKS = {
  "/production": "/production/planner",
  "/inventory": "/inventory",
  "/sales": "/sales/orders",
  "/engineering": "/engineering/artworks",
  "/system": "/system/users",
  "/dashboard": "/",
}

function normalizeRoute(route) {
  const raw = String(route || "").trim()
  if (!raw) return "/"
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`
  if (prefixed === "/") return "/"
  return prefixed.replace(/\/+$/, "")
}

function toRouteFromPageFile(filePath) {
  const relative = path.relative(appRoot, filePath)
  const noPage = relative.replace(/\/page\.tsx$/, "").replace(/^page\.tsx$/, "")
  if (!noPage) return "/"
  const segments = noPage
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
  if (!segments.length) return "/"
  return normalizeRoute(`/${segments.join("/")}`)
}

function parseStringArraySet(source, setName) {
  const block = source.match(new RegExp(`${setName}\\s*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`))
  if (!block) return new Set()
  return new Set([...block[1].matchAll(/["']([^"']+)["']/g)].map((match) => normalizeRoute(match[1])))
}

async function walk(dir, files = []) {
  const rows = await fs.readdir(dir, { withFileTypes: true })
  for (const row of rows) {
    const next = path.join(dir, row.name)
    if (row.isDirectory()) {
      await walk(next, files)
      continue
    }
    if (row.isFile() && row.name === "page.tsx") {
      files.push(next)
    }
  }
  return files
}

async function main() {
  const [sidebarText, sidebarNavText, navigationRoutesText, pageFiles] = await Promise.all([
    fs.readFile(sidebarPath, "utf8"),
    fs.readFile(sidebarNavPath, "utf8"),
    fs.readFile(navigationRoutesPath, "utf8"),
    walk(appRoot),
  ])

  const exactRoutes = new Set()
  for (const pageFile of pageFiles) {
    const route = toRouteFromPageFile(pageFile)
    if (!route.includes("[")) {
      exactRoutes.add(route)
    }
  }

  const hrefMatches = [...`${sidebarText}\n${sidebarNavText}`.matchAll(/href:\s*["']([^"']+)["']/g)].map((match) => normalizeRoute(match[1]))
  const uniqueHrefs = [...new Set(hrefMatches)]
  if (uniqueHrefs.length === 0) {
    console.error("Navigation route validation failed: no sidebar hrefs were discovered.")
    process.exit(1)
  }

  const failures = []
  for (const href of uniqueHrefs) {
    const direct = exactRoutes.has(href)
    const fallback = PARENT_ROUTE_FALLBACKS[href]
    const fallbackResolvable = fallback ? exactRoutes.has(normalizeRoute(fallback)) : false
    if (!direct && !fallbackResolvable) {
      failures.push({ href, fallback: fallback || null })
    }
  }

  const fallbackMissingTargets = Object.entries(PARENT_ROUTE_FALLBACKS)
    .filter(([, target]) => !exactRoutes.has(normalizeRoute(target)))
    .map(([source, target]) => ({ source, target }))
  const exactNavigableRoutes = parseStringArraySet(navigationRoutesText, "EXACT_NAVIGABLE_ROUTES")
  const resolverFailures = []
  for (const href of uniqueHrefs) {
    const direct = exactNavigableRoutes.has(href)
    const fallback = PARENT_ROUTE_FALLBACKS[href]
    const fallbackResolvable = fallback ? exactNavigableRoutes.has(normalizeRoute(fallback)) : false
    if (!direct && !fallbackResolvable) {
      resolverFailures.push({ href, fallback: fallback || null })
    }
  }

  if (failures.length || fallbackMissingTargets.length || resolverFailures.length) {
    console.error("Navigation route validation failed.")
    if (failures.length) {
      console.error("Unresolvable sidebar hrefs:")
      for (const row of failures) {
        console.error(`  - ${row.href}${row.fallback ? ` (fallback => ${row.fallback})` : ""}`)
      }
    }
    if (fallbackMissingTargets.length) {
      console.error("Fallback targets without route pages:")
      for (const row of fallbackMissingTargets) {
        console.error(`  - ${row.source} -> ${row.target}`)
      }
    }
    if (resolverFailures.length) {
      console.error("Sidebar hrefs missing from resolveNavigableRoute():")
      for (const row of resolverFailures) {
        console.error(`  - ${row.href}${row.fallback ? ` (fallback => ${row.fallback})` : ""}`)
      }
    }
    process.exit(1)
  }

  console.log(`Navigation route validation passed. Checked ${uniqueHrefs.length} sidebar routes and ${exactNavigableRoutes.size} resolver routes.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
