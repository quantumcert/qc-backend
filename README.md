# Quantum Cert Backend

API canônica da Quantum Cert para tenants, usuários, assets, rastreabilidade on-chain, créditos, QTAGs e operações administrativas B2B.

## Papel no ecossistema

Este repositório concentra a camada de backend da plataforma:

- contratos HTTP para dashboard, integrações B2B e consulta pública;
- gestão de tenants, usuários, API keys e escopos;
- registro e ciclo de vida de assets;
- filas de ancoragem em blockchain e adaptadores multi-chain;
- ledger de créditos, QTAGs, auditoria e eventos operacionais.

## Documentação canônica

A documentação operacional, roadmap, decisões de produto, UATs e planejamento cross-repo ficam em:

- `qc-business/planning`
- `https://github.com/quantumcert/qc-business/tree/main/planning`

Não mantenha planning local duplicado neste repositório.

## Desenvolvimento local

```bash
npm install
npm run db:generate
npm run db:push
npm run seed:bootstrap
npm run dev
```

O servidor de desenvolvimento usa `src/server.ts`. Configure as variáveis locais a partir de `.env.example`.

## Validação

```bash
npm test -- --run
npm run build
git diff --check
```

## Observação

Mudanças de escopo, decisões de fase e documentação de governança devem ser registradas primeiro em `qc-business/planning`.
