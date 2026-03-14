#!/usr/bin/env python
"""
Phase 53.5 — Seed Standard Processes

Updates existing processes with correct physical-only configuration:
- Extrusion: BULK → ROLL, single in/out
- Printing: ROLL → ROLL, single in/out
- Lamination: ROLL → ROLL, multi-in, single out
- Slitting: ROLL → ROLL, single in, multi-out
- Pouching/Bag Making: ROLL → BULK, single in/out
"""

import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.factory.models import Process

PROCESS_CONFIG = {
    'EXTRUSION': {
        'name': 'Extrusion',
        'input_form': 'BULK',
        'output_form': 'ROLL',
        'allows_multi_roll_input': False,
        'allows_multi_roll_output': False,
        'consumption_mode': 'FULL',
    },
    'PRINTING': {
        'name': 'Printing',
        'input_form': 'ROLL',
        'output_form': 'ROLL',
        'allows_multi_roll_input': False,
        'allows_multi_roll_output': False,
        'consumption_mode': 'FULL',
    },
    'LAMINATION': {
        'name': 'Lamination',
        'input_form': 'ROLL',
        'output_form': 'ROLL',
        'allows_multi_roll_input': True,  # Combines multiple rolls
        'allows_multi_roll_output': False,
        'consumption_mode': 'FULL',
    },
    'SLITTING': {
        'name': 'Slitting',
        'input_form': 'ROLL',
        'output_form': 'ROLL',
        'allows_multi_roll_input': False,
        'allows_multi_roll_output': True,  # Produces multiple rolls
        'consumption_mode': 'FULL',
    },
    'BAG_MAKING': {
        'name': 'Bag Making / Pouching',
        'input_form': 'ROLL',
        'output_form': 'BULK',  # Produces finished pouches (counted qty)
        'allows_multi_roll_input': False,
        'allows_multi_roll_output': False,
        'consumption_mode': 'FULL',
    },
}

def seed_processes():
    print("Phase 53.5 — Updating Standard Processes...")
    
    for code, config in PROCESS_CONFIG.items():
        process, created = Process.objects.update_or_create(
            code=code,
            defaults={
                'name': config['name'],
                'input_form': config['input_form'],
                'output_form': config['output_form'],
                'allows_multi_roll_input': config['allows_multi_roll_input'],
                'allows_multi_roll_output': config['allows_multi_roll_output'],
                'consumption_mode': config['consumption_mode'],
                'is_active': True,
                'is_system': True,
            }
        )
        action = "Created" if created else "Updated"
        print(f"  {action}: {code} ({config['input_form']} → {config['output_form']})")
    
    print("\n✅ Standard processes configured successfully!")

if __name__ == '__main__':
    seed_processes()
