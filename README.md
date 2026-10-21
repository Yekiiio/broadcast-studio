# Broadcast Studio

Overlays de broadcast **100 % gratuits** pour League of Legends. Un panneau de contrôle, 10 overlays pour OBS et un éditeur de style complet.

## Overlays
| Overlay | Contenu |
|---|---|
| Scoreboard | équipes, kills, or, tours, dragons, chrono, score de série, écart d'or |
| Joueurs | champion, sorts, rune, KDA, participation aux kills, CS, or, objets |
| Objectifs | timers dragon/baron, inhibiteurs, graphique d'écart d'or |
| Champ select | picks, bans, timer, phase, **Fearless** (champions déjà utilisés) |
| Carte de série | score BO1/BO3/BO5 |
| Kill feed | kills en direct avec icônes |
| Annonceur | premier sang, multikills, ace, dragon, baron, héraut, tourelles, inhibiteurs |
| Post-game | stats de fin de partie, totaux, graphique d'or |
| Cadre L | panneau gauche + barre du bas : sponsor, commentateurs, bandeau défilant |
| Bracket / programme | tableau des matchs par phase |

## Personnalisation
- **Éditeur de style** (onglet *Style*) : aperçu interactif, **glisse** un bloc pour le déplacer, **molette** pour le redimensionner ; masque les composants que tu ne veux pas ; couleurs, police et arrondi **par overlay** ; **CSS personnalisé**.
- **Bannières** : image de fond par overlay et **bannière propre à chaque équipe** (onglet *Équipes*).
- **Thèmes** globaux (4 préréglages, entièrement modifiables).
- **Overlays perso** : dépose tes pages HTML dans le dossier indiqué dans *Réglages* ; elles reçoivent toutes les données en direct (voir `exemple.html`).
- **Programme des matchs** : plusieurs matchs, bascule en un clic, alimente le bracket.
- **Sauvegarde** : export / import de toute la configuration (logos et bannières inclus).

## Raccourcis clavier (application)
`Ctrl+Alt+1…9, 0` afficher/masquer les overlays · `Ctrl+Alt+←/→` +1 victoire bleue/rouge · `Ctrl+Alt+H` tout masquer · `Ctrl+Alt+S` tout afficher · `Ctrl+Alt+T` timer du draft · `Ctrl+Alt+Z` annuler un pick.

## Installation
```bash
npm install
npm start          # lance l'application (Electron)
npm run dist:win   # génère dist/BroadcastStudio-1.1.0-portable.exe (Windows 64 bits)
npm run server     # serveur seul, sans fenêtre (http://127.0.0.1:3777/control/)
```
Nécessite Node.js 18+.

### Obtenir le .exe sans rien installer
Envoie le projet sur GitHub → onglet **Actions** → *Build Windows exe* → **Run workflow** → télécharge l'artefact.
Pour le publier dans **Releases** : crée une release avec un tag `v1.1.0` ; l'exe y est ajouté automatiquement.

## Utilisation dans OBS
Source **Navigateur**, URL `http://127.0.0.1:3777/overlays/<nom>.html`, largeur 1920, hauteur 1080 (bouton « Copier l'URL » dans le tableau de bord).

## Données de jeu
- **Partie réelle** : Live Client API de Riot (`https://127.0.0.1:2999`), active pendant une partie. L'or est une **estimation** (valeur des objets).
- **Démo** : partie simulée pour régler les overlays sans lancer le jeu.
- **Champ select** : manuel, ou « Auto (client LoL) » via le LCU (meilleur effort).

## Non inclus
Contrôle de caméra / cinématiques / multi-view, sessions distantes, contrôles d'audience Twitch, graphiques de dégâts et efficacité de l'or (données absentes de l'API).

## Mentions
Projet indépendant, non approuvé par Riot Games. League of Legends et Riot Games sont des marques de Riot Games, Inc. Images de champions : Data Dragon.
