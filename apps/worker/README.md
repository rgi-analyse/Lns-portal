# @synapse/worker

Azure Functions worker for analyse-modulen.

## Oppgaver

Workeren poller `ai_analyse_bestilling`-tabellen hvert minutt for
bestillinger med status BESTILT, kjører dem gjennom AI-pipeline,
og produserer Word-rapporter som lagres i Azure Blob Storage.

## Lokal utvikling

1. Installer Azure Functions Core Tools v4
2. Kopier `local.settings.json.example` til `local.settings.json`
   og fyll inn verdier
3. `npm install` (fra repo-rot)
4. `npm run dev` (fra apps/worker/) i én terminal
5. `func start` (fra apps/worker/) i annen terminal

## Deploy

Deploy via GitHub Actions ved push til main (deploy-worker-jobb i
.github/workflows/deploy.yml).
