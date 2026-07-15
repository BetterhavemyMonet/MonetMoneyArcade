#!/data/data/com.termux/files/usr/bin/bash

PROJECT_DIR="MonetMoneyArcade"

FILE=$(find "$PROJECT_DIR" -type f -name "gator.html" | head -n 1)

if [ -z "$FILE" ]; then
  echo "gator.html not found inside $PROJECT_DIR"
  exit 1
fi

echo "Found: $FILE"

echo "Creating backup..."
cp "$FILE" "$FILE.bak"

echo "Injecting DINO offset..."

# Add offset constant if missing
if ! grep -q "DINO_Y_OFFSET" "$FILE"; then
  sed -i '1i const DINO_Y_OFFSET = 10;' "$FILE"
fi

echo "Fixing platform alignment..."
sed -i 's/player\.y *= *platform\.y *- *player\.height;/player.y = platform.y - player.height - DINO_Y_OFFSET;/g' "$FILE"

echo "Fixing drawImage Y positioning..."
sed -i 's/ctx\.drawImage(\([^,]*\), \([^,]*\), \([^,]*\), \([^,]*\), \([^)]*\))/ctx.drawImage(\1, \2, \3 - DINO_Y_OFFSET, \4, \5)/g' "$FILE"

echo "Done. Dino should now sit properly on platforms."
