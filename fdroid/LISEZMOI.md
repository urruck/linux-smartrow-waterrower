# Publication sur F-Droid

L'application Android est prête pour F-Droid :

- licence libre (GPL-3.0-or-later), aucune dépendance propriétaire : pas de
  Google Play Services ni Firebase (le GPS passe par `LocationManager`
  d'Android), pas de pistage, pas de publicité ;
- construction depuis les sources avec Node.js et Gradle seulement
  (`construire_www.mjs` copie les fichiers, sans outil binaire d'assemblage) ;
- pas de bloc de dépendances chiffré de Google dans l'APK (`dependenciesInfo`) ;
- fiche (descriptions, icône, captures, nouveautés) dans `fastlane/metadata/android/`.

## Proposer l'application

1. Créer un compte sur gitlab.com et faire une copie (fork) de
   https://gitlab.com/fdroid/fdroiddata.
2. Copier `io.github.urruck.rameur.yml` dans `metadata/` de cette copie.
3. Vérifier, si possible : `fdroid readmeta`, `fdroid lint io.github.urruck.rameur`,
   `fdroid build -v -l io.github.urruck.rameur`.
4. Ouvrir une demande de fusion (merge request) ; les relecteurs de F-Droid
   répondent dans la demande.

## Nouvelle version

1. Augmenter `version` dans `mobile/package.json` (le code de version vaut
   a×10000 + b×100 + c : 0.3.0 → 300) et lancer `mobile/construire_apk.sh`,
   qui reporte les numéros dans `android/app/build.gradle`.
2. Écrire `fastlane/metadata/android/*/changelogs/<code>.txt`.
3. Valider, puis poser l'étiquette `vX.Y.Z` : F-Droid la détecte tout seul.

F-Droid signe l'APK avec sa propre clé : on ne peut pas installer sa version
par-dessus celle du GitHub (désinstaller d'abord, après avoir exporté ses
données depuis Aventure → Sauvegarde et transfert).
