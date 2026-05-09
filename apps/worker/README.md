# Status: Pauset

Denne mappen inneholder skjelettet for en Azure Function-basert worker.
Vi har midlertidig flyttet polling-logikken til apps/api via node-cron
fordi Function App-deploy hadde betydelig friksjon.

Koden her tjener som referanse. Hvis vi senere vil flytte tilbake til
Azure Functions (f.eks. ved skalering eller ressursseparasjon), kan
denne strukturen brukes igjen.

Faktisk worker-logikk: apps/api/src/workers/analyseWorker.ts

---

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
