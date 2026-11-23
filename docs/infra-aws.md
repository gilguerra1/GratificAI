# Implantação na AWS

## Arquitetura

O tráfego público passa por **CloudFront -> ALB -> ECS Fargate**. A task do ECS executa os contêineres `web` (frontend) e `api`, que acessam o **RDS PostgreSQL 17**. A VPC usa VPC endpoints e não depende de NAT. A observabilidade envia telemetria via OpenTelemetry para Grafana LGTM em uma EC2 privada.

## Pipeline

1. **Source** — obtém o repositório com **Clone completo (Full clone)**, necessário para a verificação do histórico.
2. **Segurança** e **Testes** — executam em paralelo. Segurança roda gitleaks, `npm audit` e Semgrep; Testes instala dependências com `npm ci`, executa Vitest e o build.
3. **Imagens** — constrói as imagens Docker da API e do frontend, verifica ambas com Trivy e publica no ECR usando como tag os 12 primeiros caracteres do SHA do commit.
4. **Deploy no ECS** — atualiza a task/service com as imagens publicadas.
5. **Verificação pós-deploy** — confirma que `/api/health` e `/api/auth/setup` respondem HTTP 200 em menos de um segundo.

## Buildspecs

Os caminhos abaixo são consumidos pelo CodeBuild e devem permanecer estáveis:

- `buildspecs/seguranca.yml` — verificações de segredos no histórico, dependências e código.
- `buildspecs/testes.yml` — instalação, testes Vitest e build do frontend.
- `buildspecs/imagens.yml` — build das imagens, scan Trivy, push no ECR e artefato `imagedefinitions.json`.
- `buildspecs/verificacao.yml` — verificações HTTP pós-deploy.

## Arquivos de `infra/aws/`

- `task-definition.json` — definição da task Fargate, contêineres, portas, health check, logs, variáveis de ambiente e referência ao segredo de banco.
- `iam/ecsTaskExecutionRole-ler-segredo.json` — permissões de execução para leitura do segredo RDS e criação do grupo de logs.
- `iam/gratificai-codebuild-role.json` — permissões do CodeBuild para conexão GitHub, logs, artefatos, relatórios e push no ECR.
- `iam/gratificai-pipeline-role.json` — permissões do pipeline para usar a conexão GitHub, iniciar CodeBuild e registrar/atualizar serviços ECS.

Os arquivos são modelos: substitua os placeholders somente em cópias locais, salvas como `*.local.json` e ignoradas pelo Git. Não versione valores reais.

## Variáveis de ambiente da task

Configure os valores reais no ambiente da AWS, sem gravá-los no repositório:

- Aplicação: `NODE_ENV`, `APP_ORIGIN`, `API_HOST`, `API_PORT`.
- Banco: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`; `PGPASSWORD` é obtida do Secrets Manager.
- Telemetria: `NODE_OPTIONS`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` e `OTEL_NODE_DISABLED_INSTRUMENTATIONS`.
