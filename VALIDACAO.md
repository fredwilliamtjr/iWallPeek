# Validação — iWallPeek 0.1.0 — 11/10/2026

## Resultado

Build release arm64 concluído. App e DMG gerados em dist/ para Apple Silicon,
macOS 13 ou superior. Assinatura ad-hoc com entitlement de Apple Events;
sem certificado Developer ID ou notarização Apple.

## Verificações executadas

- `IWALLPEEK_LIVE_TEST=1 ./scripts/verify.sh`: passou.
- Rejeição de HTTP, arquivo local, domínio impostor, credenciais e porta não permitida.
- Redirecionamento externo rejeitado; redirecionamento autorizado aceito pelo delegate.
- Conteúdo não-imagem e payload acima de 25 MiB rejeitados.
- Armazenamento com symlink rejeitado; retenção remove antigos e preserva atual/arquivos alheios.
- Teto de 500 MiB validado com arquivos esparsos; preservação da imagem atual.
- Bing: download real de 3.551.609 bytes em www.bing.com, decodificado como imagem válida.
- Spotlight: download real de 1.632.173 bytes em res.public.onecdn.static.microsoft, decodificado como imagem válida.
- `./build.sh arm64`: build release, codesign e hdiutil verify passaram.
- DMG montado somente leitura: assinatura do app validada; todos os arquivos
  comparados por SHA-256 com o app externo e encontrados idênticos; atalho Aplicativos presente.
- Checksum SHA-256 do DMG verificado.
- `bash -n`, `plutil -lint` e `git diff --check`: passaram.

O teste de armazenamento encontrou e permitiu corrigir uma combinação incompatível
entre `.atomic` e `.withoutOverwriting` do Foundation antes da entrega final.
XCTest não estava disponível nas Command Line Tools; o verificador é um executável
Swift independente, compilado contra os mesmos arquivos de produção.

## Referência adicional consultada

DailyFrame, commit 95dbc3e8ed1315509d5a30ae285857b8a1f29ed8:
LoginItem.swift:15 usa SMAppService; WallpaperManager.swift:35 usa NSWorkspace;
AppState.swift:125 faz checagem periódica. Usado como comparação de arquitetura,
sem incorporar arquivos ou ampliar o escopo para Unsplash/histórico.
https://github.com/amalik99/DailyFrame/tree/95dbc3e8ed1315509d5a30ae285857b8a1f29ed8

## Homologação pendente

NÃO VERIFIQUEI — app instalado/em execução com interface, alteração do desktop,
Automação de System Events em todos os Spaces, registro no login ou fundo da tela
bloqueada. Essas verificações manuais ficam com Fred conforme TESTAR.md.
Não há implementação separada de fundo da tela de bloqueio ou login após reiniciar.

## Git

Trabalho isolado em codex/feature/iwallpeek, no worktree .codex/worktrees/iwallpeek.
O checkout principal mantém a base original DailyWalls.
Não há remoto de publicação do iWallPeek configurado; upstream é somente a origem
DailyWalls e não é destino para publicar este projeto.
