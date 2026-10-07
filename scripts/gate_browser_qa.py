"""Run isolated local browser acceptance without logging fixture credentials."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / ".runtime" / "gate-qa.json"
CLI = "/Users/devarshthakkar/.codex/skills/playwright/scripts/playwright_cli.sh"


def run(code):
    env = dict(os.environ, PWTEST_DAEMON_SESSION_DIR="/private/tmp/tpp-gate-pw-daemon",
               npm_config_cache="/private/tmp/tpp-gate-npm-cache")
    result = subprocess.run([CLI, "--session=tpp-gate-qa", "run-code", code], cwd=ROOT,
                            env=env, text=True, capture_output=True)
    output = result.stdout + result.stderr
    # The CLI echoes executed source; credentials exist only in this process.
    if "### Ran Playwright code" in output:
        before, rest = output.split("### Ran Playwright code", 1)
        closing = rest.find("```", rest.find("```") + 3)
        output = before + rest[closing + 3:] if closing >= 0 else before
    fixtures = json.loads(PRIVATE.read_text())
    for value in fixtures.values():
        if isinstance(value, dict) and value.get("password"):
            output = output.replace(value["password"], "[private fixture password]")
    print(output)
    if result.returncode:
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    if sys.argv[1] == "login":
        account = json.loads(PRIVATE.read_text())[sys.argv[2]]
        run("async (page) => { "
            "if (!page.url().includes('/login')) { await page.context().clearCookies(); await page.goto('http://127.0.0.1:3017/login'); } "
            f"await page.getByRole('textbox', {{name:'Work email or username'}}).fill({json.dumps(account['username'])}); "
            f"await page.locator('[data-testid=login-password]').fill({json.dumps(account['password'])}); "
            "const responsePromise = page.waitForResponse(r=>r.url().includes('/api/users/login') && r.request().method()==='POST'); "
            "await page.getByRole('button',{name:'Sign in',exact:true}).click(); "
            "const response = await responsePromise; if(response.status() !== 200) throw new Error('Login response ' + response.status()); "
            "await page.waitForURL(url => !url.pathname.startsWith('/login'), {timeout:30000}); "
            "return {url:page.url(), title:await page.title()}; }")
    elif sys.argv[1] == "file":
        run(Path(sys.argv[2]).read_text())
    else:
        raise SystemExit("Use login <fixture role> or file <Playwright snippet>.")
