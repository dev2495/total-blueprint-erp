
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

dbname = os.getenv('DB_NAME', 'total_blueprint_erp')
user = os.getenv('DB_USER', 'blueprint_admin')
password = os.getenv('DB_PASSWORD', '')
host = os.getenv('DB_HOST', '127.0.0.1')
port = os.getenv('DB_PORT', '5432')

print(f"Connecting to {dbname} as {user} on {host}:{port}...")
try:
    conn = psycopg2.connect(
        dbname=dbname,
        user=user,
        password=password,
        host=host,
        port=port,
        connect_timeout=5
    )
    print("Connection successful!")
    conn.close()
except Exception as e:
    print(f"Connection failed: {e}")
