# Vidéo de démo Thoughtful (2 min 50, en anglais)

Règlement : moins de 3 min, YouTube ou Vimeo public, en anglais, aucune marque ni musique tierce sans droit, et **montrer le projet utilisant de vraies données Bee** (« mentioning Bee isn't enough »). Recette de tournage et de montage : skill `video-demo-hackathon` (capture CDP 60 i/s, voix clonée du propriétaire, sous-titres, −14 LUFS, export ≤ 10 Mo pour Devpost).

## Avant de tourner (obligatoire)

1. **Consentement écrit** du proche adulte qui parle à table (modèle ci-dessous), signé et daté **avant** que la montre enregistre, conservé **hors du dépôt**. Aucun mineur, aucun passant audible, pas de télé allumée.
2. **Vraies données** : la scène du repas est réelle et captée par la montre ; la carte du soir montre ce que Bee a vraiment entendu, extrait par Bedrock. Ne rien rejouer à la main.
3. **Masquage** : app iPhone avec `?mask=1` (prénoms, citations, notes floutés) pour tout plan où apparaîtrait un tiers non consentant ; floutage au montage de toute adresse, coordonnée, e-mail, nom de famille. Le prénom du proche consentant peut rester s'il l'accepte (case dans le formulaire), sinon le remplacer à l'écran par une initiale.
4. **Jamais à l'écran** : `bee status` (affiche un fragment du jeton), le terminal avec des variables d'environnement, l'adresse Gmail, le trousseau.
5. Mention à l'écran pendant la scène du repas : « Recorded with consent ».
6. Sur les plans Echo Show : petite mention « Alexa+ experience simulated in mcp-voice-host (open source) » : le règlement autorise une expérience Alexa+ simulée, mais il faut le dire.

### Modèle de consentement (à imprimer, une ligne suffit)
> I, ________ (adult), agree that our conversation on __/__/2026 is recorded by Blanco's Bee wearable and that what I say may appear, subtitled, in a public demo video for the Amazon Developer hackathon. ☐ My first name may be shown ☐ Use an initial instead. Signature: ________ Date: ________

## Script (voix off du propriétaire, en anglais)

| Temps | Image | Voix / texte à l'écran |
|---|---|---|
| 0:00–0:12 | Gros plan : un dîner, la montre au poignet, des mains, des rires (sans visage si le proche préfère) | VO (à adapter à la vraie histoire, ne rien affirmer de faux) : "My sister tells me what she wants all year. By her birthday, I have forgotten. This year, Bee heard it." |
| 0:12–0:30 | Plans rapides : extraits d'avis sur les IA portées qui parlent au mauvais moment (texte seul, sans logo) puis l'écran d'accueil de Thoughtful | VO: "Wearables that talk at dinner get taken off. So Thoughtful has one rule: it never interrupts. It keeps what the people you love care about, and gives it back at the right moment." |
| 0:30–0:55 | Le vrai repas (sous-titré, « Recorded with consent ») : le proche dit une envie, une date, le propriétaire promet quelque chose | Sous-titres de la vraie phrase. VO courte : "I'm not taking notes. Neither is Thoughtful, not yet." |
| 0:55–1:10 | iPhone, Réglages > « What Thoughtful did » : « Read 1 conversation from Bee. 3 new notes to confirm. 2 set aside (sensitive, …) » | VO: "Bee hears everything, including the TV and the things that aren't mine to keep. Thoughtful drops health, conflicts, politics, money, and anything that sounds like a broadcast." |
| 1:10–1:45 | 20:05, Echo Show 15 (mcp-voice-host, cadre Show 15). Il dit : "Alexa, what's on Thoughtful tonight?" La carte en trois colonnes apparaît | VO: "At night, right after Bee's own summary, one calm card. Three things at most." Il touche **Yes, keep it** sur la note : texte à l'écran « Saved to Bee as a confirmed fact ». Plan de 2 s sur la liste des facts dans l'app Bee (iPhone) avec le nouveau fact |
| 1:45–2:10 | Même carte : « Something for Léa · Hidden on shared screens ». Il touche **Show** : ses mots datés, 3 vrais cadeaux, un atelier près de chez lui | VO: "Her birthday is in twelve days. Here are her own words, three real gifts that match them, and a place we could go together. On a shared screen it stays covered until I say so. Thoughtful never buys anything." |
| 2:10–2:30 | Le lendemain : la montre / l'iPhone affiche le rappel Bee « Seeing Léa: … » 30 min avant le rendez-vous (si la montre ne vibre pas : écran verrouillé de l'iPhone + liste des todos sur la montre) | VO: "The next day, one tap on my wrist, half an hour before I see her. Never during a conversation. Never more than twice a day." |
| 2:30–2:42 | Fire TV / navigateur TV : « Sunday », puis l'écran Réglages : « Erase everything » | VO: "On Sunday, the TV shows the week, names only. Everything stays on my Mac. One tap erases it, in Bee too." |
| 2:42–2:50 | Plan final : la carte du soir vide, « Nothing tonight » ; logo Thoughtful | Texte : "Thoughtful. Be the one who remembers. Built on Bee, Amazon Bedrock and MCP." |

## Plan B honnête
- Si la montre ne vibre pas sur l'alarme d'un todo : montrer la notification sur l'iPhone et le todo dans la liste de la montre, et le dire (pas de faux plan).
- Si les clés Channel3 / Places ne sont pas posées le jour du tournage : ne pas montrer de cadeaux inventés ; éviter aussi de filmer le message « Real gift ideas appear here once a Channel3 key is set » : poser les clés avant le tournage (scripts dans `scripts/`).
- Le foyer exemple (données inventées) peut servir pour un plan de 3 s « try it yourself », étiqueté comme tel.

## Captures utiles (déjà scriptées)
- Echo Show : `HOST_URL=http://localhost:4290 OUT=shots SHOTS=show15:light CLICK=show node scripts/shoot-echo.mjs` (mcp-voice-host lancé sur le port 4290).
- iPhone : `node "/Volumes/Dev Projects/Boite-a-outils/13-captures-navigateur/outils/captures-3-formats.mjs" "http://127.0.0.1:4317/?mask=1#/tonight" shots`.
- TV : `http://127.0.0.1:4317/tv` en 1920×1080.
