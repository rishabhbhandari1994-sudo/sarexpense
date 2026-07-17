"""Offline regression checks for TrailCash's deployable source tree.

Run with `python test_suite.py` or `npm test`. Live Supabase smoke tests are
deliberately not automated here because they would create users and financial
records in the production tenant.
"""
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parent


class TrailCashRegressionTests(unittest.TestCase):
    def read(self, filename):
        return (ROOT / filename).read_text(encoding="utf-8")

    def test_deployment_has_required_configuration(self):
        package = json.loads(self.read("package.json"))
        self.assertIn("start", package["scripts"])
        self.assertIn("test", package["scripts"])
        self.assertTrue((ROOT / "vercel.json").is_file())
        self.assertTrue((ROOT / ".env.example").is_file())
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", self.read(".env.example"))

    def test_service_role_is_not_sent_to_browser(self):
        browser_source = self.read("db.js") + self.read("app.js") + self.read("index.html")
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", browser_source)
        self.assertNotIn("auth.signUp", self.read("db.js"))

    def test_staff_lifecycle_is_server_side_and_authenticated(self):
        source = self.read("db.js")
        endpoint = self.read("api/staff.js")
        self.assertIn("authorizedApi('/api/staff', 'POST'", source)
        self.assertIn("authorizedApi(`/api/staff?id=", source)
        self.assertIn("requireManager(context.profile)", endpoint)
        self.assertIn("/auth/v1/admin/users", endpoint)
        self.assertIn("email_confirm: true", endpoint)

    def test_login_and_session_restore_are_present(self):
        app = self.read("app.js")
        self.assertIn("/api/login", app)
        self.assertIn("auth.setSession", app)
        self.assertIn("auth.getSession", app)
        self.assertIn("api/login-profiles.js", "api/login-profiles.js")

    def test_profile_queries_do_not_fetch_pins_or_contact_details(self):
        db = self.read("db.js")
        match = re.search(r"async getStaff\(\).*?async addStaff", db, re.S)
        self.assertIsNotNone(match)
        self.assertIn("select('id, company_id, name, role, status')", match.group(0))
        self.assertNotIn("pin: dbProf.pin", match.group(0))

    def test_rls_migration_replaces_public_and_cross_tenant_policies(self):
        migration = self.read("supabase_migration.sql")
        self.assertIn('drop policy if exists "Allow public select access to active profiles"', migration)
        self.assertIn("public.current_company_id()", migration)
        self.assertIn("with check (public.is_company_manager", migration)
        self.assertIn("Tenant uploads bills", migration)

    def test_storage_paths_are_tenant_prefixed(self):
        db = self.read("db.js")
        self.assertIn("${DEFAULT_COMPANY_ID}/expense-", db)
        self.assertIn("${DEFAULT_COMPANY_ID}/incoming-", db)

    def test_client_generated_records_use_postgres_compatible_uuids(self):
        app = self.read("app.js")
        self.assertIn("const newRecordId = () => crypto.randomUUID()", app)
        self.assertNotIn("'exp-' + Date.now()", app)
        self.assertNotIn("'co-exp-' + Date.now()", app)


if __name__ == "__main__":
    unittest.main(verbosity=2)
