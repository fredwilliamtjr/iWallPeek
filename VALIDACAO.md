# Validação — iWallPeek 0.3.0 (Electron) — 18/11/2026

Reescrita em Electron 33 (mesma base do IRustPeek) para macOS, Windows e Linux.

## Verificações executadas

- `npm test` (node:test, porta do verify.swift + modelo + Linux) no macOS, Windows e
  Ubuntu do GitHub Actions: 13/12/12 aprovados (o teste JXA só roda no macOS).
- Rede: rejeição de HTTP, domínio impostor, credenciais, portas, IP e redirecionamento
  externo (recusado antes de conectar); limites de bytes declarados e reais.
- Imagens: não-imagem, excesso de bytes, APNG, dimensões/pixels acima do limite e
  divergência com o decodificador real; cache, teto de 500 MB, symlink; exportação
  idempotente sem sobrescrever nem seguir link.
- macOS: transformação do Index.plist via JXA com quatro mesas fictícias, preservando
  mesas, monitores, protetor de tela e campos alheios; formato desconhecido rejeitado;
  AllSpacesAndDisplays "$null" aceito.
- Feeds reais (`npm run test:live`): 8 imagens Bing pt-BR e 8 en-US; Bing 3840x2160
  (3.718.872 bytes) e Spotlight 1920x1080 (1.350.439 bytes).
- Windows (runner GitHub): `SystemParametersInfo` aplicado de verdade num caminho com
  espaço e acento; registro `Wallpaper` e `WallpaperStyle=10` conferidos; arquivo
  inexistente recusado. Versão do .exe conferida.
- Ubuntu 24.04 limpo (Docker, arm64 nativo e amd64 emulado): `apt install` do .deb,
  app aberto sob Xvfb com `XDG_CURRENT_DESKTOP=ubuntu:GNOME`; `picture-uri` e
  `picture-uri-dark` passaram de `adwaita-l.jpg` para a imagem do Bing baixada,
  `picture-options=zoom`; ícone registrado como StatusNotifierItem e menu lido via
  dbusmenu (Abrir, Atualizar, Sair); captura da janela conferida.
- macOS (Mac Studio, macOS 27): app em desenvolvimento e o app empacotado do DMG
  universal (x86_64 + arm64) rodaram em modo simulação (`IWALLPEEK_DRY_RUN=1`, dados
  em pasta temporária): atualização diária, histórico Bing (8 itens), anterior,
  aplicar, Spotlight e Configurações; capturas de todas as telas conferidas.

## Achados corrigidos durante a validação

- O .deb pedia `libasound2 | libasound2t64`; num Ubuntu 24.04 limpo o apt escolhia
  `liboss4-salsa-asound2` e o app não abria. Agora `libasound2t64 | libasound2` e `libgbm1`.

## Limitações e homologação

NÃO VERIFIQUEI — aplicação real do fundo no macOS (NSWorkspace por monitor e gravação
do Index.plist + reinício do WallpaperAgent): o Mac de teste tem fundo personalizado
e não foi alterado. A lógica é a mesma da 0.2.1, agora via JXA; a transformação foi
testada com fixtures. Também não verifiquei: KDE/XFCE/Cinnamon/MATE reais, janela do
Windows com interação, início com o sistema após reiniciar. Roteiro em TESTAR.md.

Sem evento de troca de mesa no Electron: no modo alternativo do macOS (sem configuração
global) a imagem é reaplicada na mesa ativa a cada minuto, e não no instante da troca.
As preferências da versão Swift (UserDefaults) não são migradas; o cache sim (mesma pasta).
Assinatura ad-hoc só do executável (igual ao IRustPeek 0.1.6), sem notarização;
Windows sem assinatura de código.

# Validação — iWallPeek 0.2.1 — 18/11/2026

Mesmo código da 0.2.0; muda só o empacotamento, agora universal (Intel + Apple Silicon).

- build.sh ganhou a opção `universal`: compila arm64 e x86_64 e une com lipo.
  O nome do DMG passa a usar a versão do Info.plist.
- Build feito num Mac Intel (x86_64, macOS 26.7.3, Swift 6.3.3, Command Line Tools).
- lipo: binário com as fatias x86_64 e arm64; minos 13.0 nas duas.
- codesign --verify --deep --strict, hdiutil verify e checksum SHA-256 passaram.
- scripts/verify.sh: passou.

NÃO VERIFIQUEI — execução do app em Mac Intel nem em Mac com chip Apple a partir
deste DMG. Vale repetir o roteiro de TESTAR.md nos dois tipos de Mac.

Saída: dist/iWallPeek.app, dist/iWallPeek-0.2.1-universal.dmg e checksum correspondente.

# Validação — iWallPeek 0.2.0 — 11/10/2026

## Verificações executadas

- Build release arm64 e empacotamento DMG concluídos.
- Assinatura ad-hoc conferida com codesign; hdiutil verify e checksum SHA-256 passaram.
- DMG montado somente leitura: todos os arquivos do aplicativo comparados com o
  build e encontrados idênticos; atalho para Aplicativos presente.
- Verificador Swift compilado contra os mesmos fontes de produção: passou.
- Rejeição de HTTP, domínio impostor, credenciais, portas e redirecionamentos externos.
- Validação de imagens, tamanho máximo, retenção, teto de cache e proteção contra symlinks.
- Exportação idempotente sem sobrescrever conteúdo diferente nem seguir link no destino.
- Preferências de autossalvamento/pastas separadas para Bing e Spotlight.
- Transformação do arquivo de wallpaper testada com quatro mesas fictícias,
  preservando mesas, monitores, protetor de tela e campos alheios. Formato desconhecido rejeitado.
- Testes reais de rede: oito imagens Bing pt-BR e oito en-US; downloads válidos
  de Bing (3.551.609 bytes) e Spotlight (1.198.264 bytes).
- Sintaxe dos scripts e plists verificada. git diff --check sem erros.

## Limitações e homologação

NÃO VERIFIQUEI — aplicativo instalado/em execução com interface, alteração real
nas quatro mesas do MacBook, bookmarks de pastas escolhidas pela interface ou
registro no login. O roteiro está em TESTAR.md.
A tentativa de renderização fora da tela não permitiu avaliar o visual completo;
a revisão visual fica incluída na homologação manual.

O método global das mesas usa formato privado do macOS 14+, com validação de
estrutura e backup antes de gravar. Os testes de transformação não provam que
cada versão do WallpaperAgent aplicará a imagem em todas as mesas. Se a operação
falhar, o aplicativo usa reaplicação ao entrar em outra mesa. Essa alternativa
também é usada no macOS 13. A janela informa o modo utilizado.

A tela de bloqueio acompanha o papel de parede conforme o macOS; não há escolha
independente de fonte nem modificação do login após reiniciar.
Assinatura ad-hoc, sem Developer ID ou notarização Apple.

## Git e artefatos

Trabalho em codex/feature/iwallpeek, no worktree .codex/worktrees/iwallpeek.
Publicação destinada a fredwilliamtjr/iWallPeek. Nenhuma alteração no checkout principal.
Saída: dist/iWallPeek.app, dist/iWallPeek-0.2.0-arm64.dmg e checksum correspondente.
