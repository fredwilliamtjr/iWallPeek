iWallPeek 0.3.0 — roteiro de teste (macOS, Windows e Ubuntu)

A 0.3.0 é a primeira versão em Electron: mesmas telas e funções da 0.2.1 (Swift),
agora também no Windows e no Linux.

Instalação
- macOS: encerre a versão anterior, abra o DMG e substitua iWallPeek em Aplicativos.
  Se o macOS bloquear, rode no Terminal deste Mac:
    xattr -dr com.apple.quarantine "/Applications/iWallPeek.app"
    open "/Applications/iWallPeek.app"
  As preferências da versão Swift não são migradas: escolha de novo serviço, região,
  pastas e início com o macOS.
- Windows: rode iWallPeek.Setup.0.3.0.exe (SmartScreen: Mais informações › Executar assim mesmo).
- Ubuntu: sudo apt install ./iWallPeek-0.3.0-amd64.deb e abra pelo menu de aplicativos.

Roteiro (repetir em cada sistema)
1. A janela abre na primeira execução e o fundo do dia é aplicado. Depois, use
   Abrir iWallPeek no ícone perto do relógio (Windows: clique esquerdo abre a janela).
2. Em Plano de fundo, escolha Bing e clique em Atualizar e aplicar; repita com Windows Spotlight.
3. Em Bing, alterne Brasil/Estados Unidos. Confira a prévia e o histórico recente.
   Navegue por anterior/próxima: o fundo deve continuar igual até clicar em aplicar.
4. Em cada serviço, escolha uma pasta diferente e habilite Autossalvar.
   Clique em Buscar e autossalvar agora e confira os arquivos nas duas pastas.
   Desabilite e confirme que novas exportações param.
5. Salve uma imagem do histórico manualmente e aplique outra como plano de fundo.
6. Com mais de um monitor, confira a imagem em todos.
7. Em Configurações, ligue Iniciar com o sistema, reinicie a sessão e confira que o
   ícone volta. Teste a retenção. Os arquivos exportados não são apagados.
8. Sem internet, confira a mensagem de erro e a preservação da imagem anterior.

Específico do macOS
9. Habilite Todas as mesas e aplique. Percorra as quatro mesas e os monitores.
   Confira a mensagem de resultado. No modo alternativo (formato não reconhecido
   ou macOS 13), a mesa ativa recebe a imagem em até um minuto.
10. Bloqueie com Control + Command + Q e confira o fundo.

Específico do Windows
11. Com várias áreas de trabalho virtuais (Win + Tab), confira a imagem em todas.

Específico do Ubuntu
12. Alterne tema claro/escuro em Configurações › Aparência: a imagem vale para os dois.
13. Bloqueie (Super + L): o GNOME mostra o mesmo fundo, desfocado.

O histórico Bing vem do serviço (até oito imagens recentes); Spotlight mantém
histórico local adquirido. O app consulta a Microsoft e envia idioma/região.
Cache: pasta de dados do app + Wallpapers (ver README).
Para desinstalar, desligue Iniciar com o sistema, encerre e remova o app.
