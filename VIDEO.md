# Vidéo de démo Thoughtful — tournage 4K par le propriétaire (2 min 45, en anglais)

**Règlement** : moins de 3 min (le jury peut s'arrêter à 3:00), YouTube public, en anglais (sous-titres anglais si l'on parle français), aucune musique ni marque tierce sans droit, et **montrer le projet qui utilise de vraies données Bee**.
**Montage** : skill `video-demo-hackathon` (voix clonée du propriétaire, sous-titres, −14 LUFS, export ≤ 10 Mo pour Devpost en plus de la 4K pour YouTube).

---

## 1. Le principe : une seule vraie scène, filmée exprès

La démo repose sur **une conversation courte et claire (3 à 5 min)** entre le propriétaire et **un proche adulte qui a accepté par écrit**. La montre Bee l'enregistre pour de vrai, Thoughtful la lit pour de vrai, et la carte du soir montre ce qu'il en a tiré. Rien n'est saisi à la main.

### Mini-scénario (aucun texte imposé : on parle naturellement)
Avant de commencer, le propriétaire explique au proche les trois sujets à aborder. Chacun parle avec ses mots, en français si c'est plus naturel.

1. **Une envie** : le proche parle d'une chose qu'il aimerait faire ou avoir. Il le dit à sa façon (« ça me ferait trop plaisir de… », « je rêve d'essayer… », « mon vieux … ne marche plus »). Les idées qui marchent bien avec de vrais cadeaux : un atelier (poterie, cuisine, reliure), un objet qui a cassé, un disque, un livre.
2. **Une date** : son anniversaire, ou un événement daté qui arrive (« c'est le 2 novembre », « samedi prochain je cours… »). **Astuce** : choisir une date dans moins de 14 jours, pour que la carte affiche l'occasion le soir même.
3. **Une promesse du propriétaire** : il propose de faire quelque chose (« je t'envoie le lien demain », « je t'apporte le livre dimanche »). C'est **sa** voix qui doit la dire (Bee reconnaît le propriétaire).
4. **Interpeller le proche par son prénom** au moins une fois (« Léa, et toi ? ») : Thoughtful sait alors à qui rattacher la note. Sinon, il crée « quelqu'un à qui vous avez parlé », à renommer dans Proches.
5. Éviter : santé, disputes, politique, argent (Thoughtful les retire de toute façon), la télé allumée, un tiers qui n'a pas accepté.

### Chronologie du jour J (contraintes Bee mesurées)
| Heure | Action |
|---|---|
| H − 10 min | Le serveur tourne (`npm start`, profil AWS configuré). Les clés Channel3 et Google Places sont dans le trousseau. Interface en anglais. |
| H | La conversation (3 à 5 min), montre au poignet, filmée en 4K. |
| H + 7 min | Bee clôt la conversation (environ 7 min après la dernière phrase, mesuré). |
| H + 9 min | Thoughtful la lit (90 s après). Vérifier dans Réglages > « What Thoughtful did » le compte de notes ; au besoin « Read the last conversation again ». |
| H + 10 min | Tournage de la carte du soir (Echo Show et iPhone). |
| J + 1, 9 h | Rappel de la promesse par Bee (bouton « Remind me tomorrow at 9 » le soir) : filmer l'iPhone et la montre. |

---

## 2. Protéger la vie privée à l'image

- **Consentement écrit** du proche, signé **avant** l'enregistrement, gardé **hors du dépôt** (modèle ci-dessous). Mention à l'écran pendant la scène : « Recorded with consent ».
- **Deux options au choix du proche** :
  - **A. Il accepte d'apparaître** : visage et prénom visibles, sous-titres de ses phrases.
  - **B. Il préfère rester discret** : on filme les mains, la table, la montre, le dos ; sa voix est remplacée au montage par des sous-titres seuls ; son prénom est remplacé à l'écran par une initiale. Pour les captures de l'app, utiliser `?mask=1` (prénoms et citations floutés) ou flouter au montage.
- **Jamais à l'écran** : `bee status` (il affiche un fragment du jeton), un terminal, une adresse, un e-mail, l'adresse Gmail, une autre conversation que celle filmée, la liste des personnes réelles hors de cette scène.
- **Echo Show** : afficher la mention « Alexa+ experience simulated in mcp-voice-host (open source) » (le règlement autorise une expérience Alexa+ simulée, mais il faut le dire).
- Pas de mineur, pas de passant audible, pas de télé ni de musique derrière.

**Modèle de consentement** (une ligne suffit, à imprimer) :
> I, ________ (adult), agree that our conversation on __/__/2026 is recorded by Blanco's Bee wearable and that what I say may appear, subtitled, in a public demo video for the Amazon Developer hackathon. ☐ I may be shown with my first name ☐ Hands only, initial instead of my name. Signature: ________ Date: ________

---

## 3. Script plan par plan (4K, 25 ou 30 i/s ; voix off du propriétaire en anglais)

| Temps | Image (cadrage) | Voix off / texte à l'écran |
|---|---|---|
| 0:00–0:10 | Gros plan : la montre au poignet sur la table, deux tasses, une main qui bouge en parlant. Lumière chaude, pas de visage au début. | VO : "The people we love tell us what matters to them all the time. We forget most of it." |
| 0:10–0:22 | Plan large doux du proche et du propriétaire (option A) ou mains et table (option B). Incrustation discrète « Recorded with consent ». | VO : "Bee hears it. Thoughtful remembers it for you, and it never interrupts a conversation." |
| 0:22–0:52 | **La vraie scène** (extraits de 3 × 8 s) : l'envie, la date, la promesse, avec sous-titres anglais de ce qui est vraiment dit. | Pas de voix off : on entend la scène, sous-titrée. |
| 0:52–1:02 | Écran iPhone (capture d'écran 60 i/s) : Réglages > « What Thoughtful did » : « Read 1 conversation from Bee… new notes to confirm… set aside… ». | VO : "Nothing happens during the day. After the conversation, Thoughtful reads it. Private topics are removed on my Mac before anything is analysed." |
| 1:02–1:30 | 20 h, salon. Echo Show 15 (mcp-voice-host, plein écran) : il dit ou tape "what's on thoughtful tonight". La carte en 3 colonnes apparaît. Zoom lent sur la note à confirmer avec la citation datée. Il touche **Yes, keep it**. | VO : "In the evening, right after Bee's own summary, one calm card. Three things at most. Every note shows the words it came from. I say yes, and it becomes a confirmed fact in Bee." |
| 1:30–1:38 | iPhone, app Bee : la liste des facts avec le nouveau fact « … kept with Thoughtful ». | Texte : « Saved to Bee as a confirmed fact » |
| 1:38–2:05 | Echo Show : la partie anniversaire est couverte (« Hidden on shared screens »). Il touche **Show** : ses mots, trois vrais cadeaux, un vrai lieu proche. Puis **Hide**. | VO : "Her birthday is in a few days. On a shared screen the surprise stays hidden until I ask. Her own words, three real gifts that match them, a real place nearby. Thoughtful never buys anything, and never says a gift out loud." |
| 2:05–2:20 | Promesse : il touche **Remind me tomorrow at 9**. Coupe : le lendemain 9 h, l'iPhone (et la montre si elle vibre) montre le rappel Bee. | VO : "The next morning, one reminder, from Bee itself. Never during a conversation, never more than twice a day." |
| 2:20–2:30 | TV (navigateur de la Fire TV ou écran 1080p) : la vue « Sunday », télécommande en main. | VO : "On Sunday, the TV shows the week. Names only, safe for the whole family." |
| 2:30–2:40 | iPhone : Réglages > « What Thoughtful stores » puis « Erase everything » (sans valider). | VO : "Everything stays on my Mac. One tap erases it, in Bee too." |
| 2:40–2:45 | Plan final : la montre au poignet, la carte du soir vide « Nothing tonight ». Logo. | Texte : "Thoughtful. Be the one who remembers. Built on Bee, Amazon Bedrock and MCP." |

---

## 4. Conseils de prise de vue 4K

- iPhone en 4K 30 i/s, mode Cinématique désactivé (mise au point stable), exposition verrouillée, lumière douce de côté.
- Écrans (Echo Show simulé, iPhone, TV) : capturer en direct à 60 i/s plutôt que filmer l'écran (skill `video-demo-hackathon`), puis composer au montage. Mettre l'app en anglais avant le tournage.
- Son de la scène : micro-cravate ou iPhone posé près des deux personnes ; couper la musique et la télé.
- Garder 2 à 3 prises de la scène : Bee doit entendre clairement l'envie, la date et la promesse.

## 5. Plans de secours honnêtes

- **La montre ne vibre pas** : montrer la notification de l'iPhone et le to-do dans la liste de la montre, sans prétendre autre chose.
- **Thoughtful ne propose pas la note attendue** : relire la conversation (Réglages > « Read the last conversation again ») ; si rien ne vient, refaire une prise plus claire (prénom interpellé, phrase d'envie nette). Ne jamais saisir une note à la main pour la vidéo.
- **Plan « essayez-le »** de 3 s possible avec le foyer d'exemple, **étiqueté** « Sample household, invented data ».
