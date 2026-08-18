import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server.server import run

if __name__ == "__main__":
    port = 8787
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(host="127.0.0.1", port=port)