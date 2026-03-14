import requests
s = requests.Session()
s.auth = ('admin', 'admin') # or whatever login is, wait the backend uses jwt or token
# just get the response and print
try:
    r = s.get('http://127.0.0.1:8000/api/production/planner/control-hub/')
    print(r.status_code)
    print(r.text[:500])
except Exception as e:
    print(e)
