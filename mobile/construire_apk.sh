#!/usr/bin/env bash
# Construit l'application Android : dist/rameur-smartrow_VERSION.apk
#
# Outils (sans sudo) : Node.js dans ~/.local/opt/node, kit Android dans
# ~/Android/Sdk, Java 21. Signature : ~/.config/rameur-smartrow/
# signature-android.properties (à sauvegarder : sans elle, plus de mise à jour
# possible par-dessus l'appli installée). Sans ce fichier : APK de débogage.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
cd "$ICI"
export PATH="$HOME/.local/opt/node/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
VERSION="$(node -p 'require("./package.json").version')"
CODE="$(node -p 'const [a,b,c]=require("./package.json").version.split(".").map(Number); a*10000+b*100+c')"

[ -d node_modules ] || npm ci --no-fund --no-audit
node construire_www.mjs
npx cap sync android
sed -i -E "s/versionCode [0-9]+/versionCode $CODE/; s/versionName \"[^\"]*\"/versionName \"$VERSION\"/" android/app/build.gradle
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

SIGNE="${RAMEUR_SIGNATURE:-$HOME/.config/rameur-smartrow/signature-android.properties}"
install -d ../dist
if [ -f "$SIGNE" ]; then
  (cd android && ./gradlew assembleRelease --no-daemon -q)
  cp android/app/build/outputs/apk/release/app-release.apk "../dist/rameur-smartrow_${VERSION}.apk"
else
  echo "Pas de signature ($SIGNE) : APK de débogage."
  (cd android && ./gradlew assembleDebug --no-daemon -q)
  cp android/app/build/outputs/apk/debug/app-debug.apk "../dist/rameur-smartrow_${VERSION}-debug.apk"
fi
ls -l ../dist/rameur-smartrow_"${VERSION}"*.apk
