iWallPeek 0.2.0 — teste no macOS 13 ou superior

1. Encerre a versão anterior, abra o DMG e substitua iWallPeek em Aplicativos.
2. Se o macOS bloquear a abertura, rode no Terminal deste Mac:
   xattr -dr com.apple.quarantine "/Applications/iWallPeek.app"
   open "/Applications/iWallPeek.app"
   A versão é assinada ad-hoc, sem notarização Apple.
3. A janela abre na primeira execução. Depois, use Abrir iWallPeek no menu.
4. Em Plano de fundo, escolha Bing e atualize; repita com Windows Spotlight.
5. Em Bing, alterne Brasil/Estados Unidos. Confira a prévia e o histórico recente.
   Navegue por anterior/próxima: o fundo deve continuar igual até clicar em aplicar.
6. Em cada serviço, escolha uma pasta diferente e habilite Autossalvar.
   Atualize e confira os arquivos nas duas pastas. Desabilite e confirme que novas
   exportações param. O cache interno continua sendo necessário ao aplicativo.
7. Salve uma imagem do histórico manualmente e aplique outra como plano de fundo.
8. Habilite Todas as mesas e aplique. Percorra suas quatro mesas e os monitores.
   Confira também a mensagem de resultado na janela. No modo alternativo, cada
   mesa recebe a imagem quando você entra nela. A configuração global usa formato
   privado do macOS, com backup prévio; esta é a principal homologação desta versão.
9. Bloqueie o Mac com Control + Command + Q e confira o fundo. O app não configura
   uma fonte independente para bloqueio nem promete o fundo de login após reiniciar.
10. Em Geral, teste início no login e retenção. Os arquivos exportados não são apagados.
11. Sem internet, confira a mensagem de erro e a preservação da imagem anterior.

O histórico Bing vem do serviço (até oito imagens recentes); Spotlight mantém
histórico local adquirido. O app consulta a Microsoft e envia idioma/região.
Cache: ~/Library/Application Support/iWallPeek/Wallpapers.
Backups de mesas: ~/Library/Application Support/iWallPeek/WallpaperBackups.
Para desinstalar, desmarque início no login, encerre e remova iWallPeek.app.
