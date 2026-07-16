import http.server
import json
import os
import urllib.parse

PORT = 8000
DATA_FILE = 'db.json'

# Ensure db.json exists with initial empty structure if not present
if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump({"staff": [], "transactions": [], "expenses": [], "incoming_money": []}, f, indent=2)
else:
    # Migrate existing db.json to add incoming_money key if missing
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            db_data = json.load(f)
        if "incoming_money" not in db_data:
            db_data["incoming_money"] = []
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(db_data, f, indent=2, ensure_ascii=False)
            print("Migrated db.json to include incoming_money field.")
    except Exception as e:
        print(f"Migration error: {e}")

def load_dotenv():
    if os.path.exists('.env'):
        with open('.env', 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ[key.strip()] = val.strip().strip('"').strip("'")

class SyncHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS headers for cross-origin testing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/config':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            load_dotenv()
            config = {
                "supabaseUrl": os.environ.get("SUPABASE_URL", ""),
                "supabaseAnonKey": os.environ.get("SUPABASE_ANON_KEY", "")
            }
            self.wfile.write(json.dumps(config).encode('utf-8'))
        elif parsed_url.path == '/api/data':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                self.wfile.write(f.read().encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/data':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    # Move directory context to where index.html exists
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server_address = ('', PORT)
    httpd = http.server.HTTPServer(server_address, SyncHTTPRequestHandler)
    print(f"TrailCash Central Sync Server running on port {PORT}...")
    httpd.serve_forever()
