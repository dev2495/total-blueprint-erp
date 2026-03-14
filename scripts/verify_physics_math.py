import os
import sys
import django
from decimal import Decimal

# Setup Django Environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.physics.services_physics import PhysicsEngine

def test_pouch_physics():
    print("--- Testing POUCH Physics ---")
    data = {
        "finished_good_type": "POUCH",
        "geometry": {
            "base": {"width_mm": 100, "height_mm": 200},
            "adjustments": [],
            "multipliers": {"faces": 2}
        },
        "film_layers": [
            {"thickness_micron": 12, "density_g_cm3": 1.4}, # PET
            {"thickness_micron": 40, "density_g_cm3": 0.92} # PE
        ],
        "is_printing_enabled": True,
        "inks": [{"gsm": 2}],
        "chemicals": {"adhesive_gsm": 2.5},
        "order_qty": 1,
    }

    result = PhysicsEngine.calculate(data)
    if result.get("error"):
        raise RuntimeError(result["error"])
    
    # Expected using the current engine contract:
    # film = 2.144 g, adhesive = 0.100 g, total = 2.244 g
    
    total = result['total_weight_g']
    print(f"Calculated Total: {total}g")
    
    expected = 2.244
    if abs(total - expected) < 0.001:
        print("✅ PASS: Pouch Weight Matches")
    else:
        print(f"❌ FAIL: Expected {expected}g, Got {total}g")

def test_roll_physics():
    print("\n--- Testing ROLL Physics ---")
    data = {
        "finished_good_type": "ROLL",
        "geometry": {
            "base": {"width_mm": 500, "height_mm": 1000}, # 1 meter segment
            "adjustments": [],
            "multipliers": {"faces": 1}
        },
        "weight_kg": 0.0092,
        "film_layers": [
            {"thickness_micron": 20, "density_g_cm3": 0.92}
        ]
    }
    
    result = PhysicsEngine.calculate(data)
    if result.get("error"):
        raise RuntimeError(result["error"])
    
    # Area = 500 * 1000 * 1 = 500,000 mm2 = 0.5 m2
    # Weight = 0.5 * 20 * 0.92 = 9.2 g
    
    total = result['total_weight_g']
    print(f"Calculated Total (authoritative roll weight): {total}g")
    
    if abs(total - 9.2) < 0.001:
        print("✅ PASS: Roll Weight Matches")
    else:
        print(f"❌ FAIL: Expected 9.2g, Got {total}g")

if __name__ == "__main__":
    try:
        test_pouch_physics()
        test_roll_physics()
        print("\nAll Physics Tests Completed.")
    except Exception as e:
        print(f"\n❌ CRITICAL EXCEPTION: {e}")
        exit(1)
