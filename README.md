# linux-smartrow-waterrower

**Une application de rameur pour Linux, avec un WaterRower équipé du capteur
SmartRow.**

L'application lit le SmartRow en Bluetooth et affiche la séance en direct dans
le navigateur. On peut l'utiliser sur le PC, ou sur une tablette ou un
téléphone posé devant le rameur. Elle propose aussi des **séances guidées**,
avec consignes vocales et bips. Tout est enregistré sur l'ordinateur : aucun
compte ni service en ligne n'est nécessaire.

Projet non officiel, sans lien avec WaterRower ni SmartRow.

![Séance guidée en cours : fractionné 30/30](captures/seance-guidee.png)

## Ce qui s'affiche

- **Temps** et **allure /500 m**, en très gros pour être lisibles depuis le
  rameur ;
- **distance**, **puissance** (actuelle et moyenne), **cadence** et nombre de
  coups ;
- **courbe de force** de chaque coup : le dernier en orange, les précédents
  en gris, pour voir la régularité ;
- **historique** des séances : date, type de séance, distance, temps, allure
  et watts moyens.

## Séances guidées

![Choix d'une séance guidée](captures/choix-seance.png)

| Séance | Niveau | Contenu |
|---|---|---|
| Découverte 12 min | Débutant | 3 min calme, 6 min facile, 3 min calme |
| Technique : changer de cadence | Débutant | Alternance 18–20 / 22–26 c/min avec la même force : on regarde la courbe |
| Endurance 20 min | Tous niveaux | 20 min faciles et régulières, la base de la progression |
| Fractionné 30/30 × 10 | Intermédiaire | 10 × (30 s fort / 30 s léger) |
| Pyramide 1-2-3-2-1 | Intermédiaire | Efforts de 1 à 3 min, récupération moitié moins longue |
| 4 × 500 m | Intermédiaire | Tenir la même allure sur 4 répétitions, 2 min de repos |
| Seuil 3 × 6 min | Confirmé | Effort soutenu et contrôlé |
| Test 1000 m | Repère | Une fois par mois pour mesurer les progrès |

Comment ça marche :
- La séance démarre **au premier coup**.
- Chaque étape donne une **zone d'effort** (calme, facile, modéré, soutenu,
  fort, repos), une **cadence cible** et une **allure visée**.
- L'allure visée est calculée à partir de **votre allure de référence** :
  par défaut, la moyenne de votre dernière séance. Après un *Test 1000 m*,
  mettez son allure moyenne comme référence.
- Les tuiles **Cadence** et **Allure** sont entourées de vert quand vous êtes
  dans la cible, d'orange sinon.
- Une voix annonce chaque étape, avec des bips à 3-2-1. La voix peut être
  coupée.

Les séances sont décrites dans [`programmes.json`](programmes.json) et
faciles à modifier. Une étape dure un temps (`temps`, en secondes) ou une
distance (`distance`, en m), et un bloc `repeter` répète des étapes.
Commencez doucement. En cas de problème de santé, demandez l'avis d'un
médecin avant les séances intenses.

## Installation

Il faut Linux avec Bluetooth (BlueZ), Python 3.9 ou plus récent, et un
navigateur.

```
git clone https://github.com/urruck/linux-smartrow-watterrower.git
cd linux-smartrow-watterrower
bash installer.sh      # installe la bibliothèque Bluetooth « bleak » dans lib/
bash rameur.sh         # lance l'appli et ouvre http://localhost:8765
```

- **Fermez l'appli SmartRow du téléphone** : le capteur n'accepte qu'une
  connexion à la fois.
- Tirez sur la poignée pour réveiller le capteur. Le programme le trouve et
  s'y reconnecte tout seul.
- **Ne l'appairez pas** dans les réglages Bluetooth. Sous Linux, un
  appairage gardé en mémoire fait échouer la connexion. Pour le retirer :
  `bluetoothctl remove <adresse>`.
- `bash rameur.sh --reseau` rend la page visible depuis une tablette ou un
  téléphone du même Wi-Fi, à l'adresse `http://<ip-du-pc>:8765`.
- **Nouvelle séance** enregistre la séance en cours et remet le compteur à
  zéro.
- Les séances sont enregistrées dans `sessions/`, au format JSON, avec un
  relevé par seconde et la courbe de chaque coup.

Pour essayer sans rameur, on peut rejouer une vraie séance enregistrée :

```
python3 rameur.py --rejouer exemples/seance-260m.log
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `rameur.py` | application : Bluetooth, petit serveur web, enregistrement |
| `page.html` | l'affichage dans le navigateur, avec les séances guidées |
| `programmes.json` | les séances guidées |
| `smartrow_ble.py` | connexion au SmartRow et décodage des messages |
| `ecouter.py` | outil de diagnostic : affiche et enregistre les messages bruts |
| `exemples/seance-260m.log` | une vraie séance enregistrée, pour les essais |

## Protocole SmartRow (V2, vérifié le 27/10/2026 sur une vraie séance)

Service BLE `0x1234`, écriture `0x1235` (un octet à la fois), notifications
`0x1236`. Initialisation `$` puis `\rV@\r` (remise à zéro), puis `$` toutes
les 1,5 s. Messages de 16 caractères + CR, en boucle (~11 par seconde) ;
les 2 derniers caractères = somme des 14 premiers octets en hexadécimal.

| Type | Contenu (indices de caractères) |
|---|---|
| tous sauf f | `[1:6]` distance en m |
| `a` | `[6:11]` temps écoulé : minutes sur 3 chiffres + secondes |
| `b` | `[7:11]` travail du coup /10 (J), `[11:14]` longueur du coup (unité ?) |
| `c` | `[6:9]` watts, `[9:14]` watts moyens /10 |
| `d` | `[6:9]` cadence /10 (coups/min), `[9:13]` nombre de coups |
| `e` | `[6:9]` allure /500 m (m ss), `[9:12]` allure moyenne |
| `f` | `[1:7]` distance en dm, `[7:11]` valeur inconnue, `[11]` = `!` à l'arrêt |
| `x` `y` `z` | courbe de force : 3 × 8 points, caractère − 33 |

Sources : logiciels libres QZ (qdomyos-zwift) et pirowflo, corrigés à
partir d'une vraie séance. Les SmartRow V3 ajoutent un défi
d'authentification (géré, non testé).

## Licence

Copyright © 2026 Yvan Godreau. Logiciel libre sous licence
[GNU GPL v3](LICENSE) ou ultérieure.
