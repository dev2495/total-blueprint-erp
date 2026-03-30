import fs from "node:fs";
import path from "node:path";

const nextTypesDir = path.join(process.cwd(), ".next", "types");

fs.rmSync(nextTypesDir, { recursive: true, force: true });
