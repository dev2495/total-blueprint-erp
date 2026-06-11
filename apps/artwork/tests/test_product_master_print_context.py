from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.artwork.compatibility import product_master_print_context, substrate_mode_from_stock_form


def _master(*, fixed=None, sizes=()):
    return SimpleNamespace(fixed_attributes=fixed or {}, sizes=list(sizes))


def _size(code, stock_form, active=True):
    return SimpleNamespace(code=code, stock_form=stock_form, roll_form="", width_basis="", active=active)


class ProductMasterPrintContextTests(SimpleTestCase):
    def test_size_stock_form_decides_tubing_even_when_legacy_film_type_says_sheet(self):
        master = _master(
            fixed={"print_type": "ROTO", "film_type": "SHEET"},
            sizes=[_size("8X11", "LAYFLAT_TUBE")],
        )

        context = product_master_print_context(master, axis_values={"size": "8X11"})

        self.assertEqual(context["print_type"], "ROTO")
        self.assertEqual(context["substrate_mode"], "TUBING")

    def test_open_web_size_maps_to_sheet(self):
        master = _master(
            fixed={"print_type": "FLEXO"},
            sizes=[_size("9X12", "OPEN_WEB")],
        )

        context = product_master_print_context(master, axis_values={"size": "9X12"})

        self.assertEqual(context["print_type"], "FLEXO")
        self.assertEqual(context["substrate_mode"], "SHEET")

    def test_stock_form_aliases_map_to_artwork_forms(self):
        self.assertEqual(substrate_mode_from_stock_form("LAYFLAT"), "TUBING")
        self.assertEqual(substrate_mode_from_stock_form("OPEN_WEB"), "SHEET")
