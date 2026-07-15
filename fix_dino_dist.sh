#!/data/data/com.termux/files/usr/bin/bash

FILE="./dist/dino_realms.html"

if [ ! -f "$FILE" ]; then
  echo "dist file not found"
  exit 1
fi

echo "Patching: $FILE"

cp "$FILE" "$FILE.bak"

# Insert offset near top of script
if ! grep -q "DINO_Y_OFFSET" "$FILE"; then
  sed -i '/<script>/a const DINO_Y_OFFSET = 10;' "$FILE"
fi

echo "Applying render fix..."

# Shift drawImage Y position up slightly
sed -i 's/ctx\.drawImage(\([^,]*\), \([^,]*\), \([^,]*\), \([^,]*\), \([^)]*\))/ctx.drawImage(\1, \2, \3 - 10, \4, \5)/g' "$FILE"

echo "Done. Reload the game."
