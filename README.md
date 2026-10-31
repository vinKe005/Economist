# Economist para iPhone

App de finanças pessoais que roda **só no celular**: instale pelo Safari em **Compartilhar → Adicionar à Tela de Início**. Este repositório contém apenas o código; nenhum dado financeiro fica aqui.

## Detalhes

Esta versão roda **só no celular**. Não precisa do PC ligado nem de servidor: os cálculos acontecem no próprio iPhone, os dados ficam guardados nele e o app funciona sem internet.

## Instalar (uma vez)

O iPhone só instala um app web quando ele é aberto por um endereço **https**. O jeito mais simples e gratuito é o GitHub Pages:

1. Em github.com, crie um repositório novo e **público**, por exemplo `economist`.
2. Clique em **"uploading an existing file"** e arraste **todo o conteúdo desta pasta**, incluindo a pasta `assets`. Depois clique em **Commit changes**.
3. Vá em **Settings → Pages**. Em "Branch", escolha `main` e a pasta `/ (root)`, e clique em **Save**.
4. Em 1 ou 2 minutos, o endereço aparece na mesma tela, algo como `https://SEU-USUARIO.github.io/economist/`.
5. Abra esse endereço no **Safari** do iPhone e toque em **Compartilhar → Adicionar à Tela de Início**.

Pronto: o ícone do Economist aparece na tela inicial. Depois da primeira abertura, funciona até no modo avião.

> Sobre privacidade: o repositório público contém só o código do app, sem nenhum dado seu. Seus lançamentos ficam apenas no iPhone.

## Passar os dados do PC para o celular

1. No Economist do PC, toque em **Salvar backup**.
2. Mande o arquivo `.json` para o iPhone (AirDrop, e-mail para você mesmo, iCloud Drive etc.) e salve em **Arquivos**.
3. No app do celular, toque em **Restaurar** e escolha o arquivo.

O caminho inverso funciona igual: o **Backup** do celular abre a folha de compartilhamento ("Salvar em Arquivos", AirDrop...). O desktop aceita esse arquivo em **Restaurar backup**.

## Cuidados importantes

- **Os dados ficam só neste iPhone.** Se você apagar o ícone do app da tela inicial, o iOS apaga junto os dados dele. Faça **Backup** de vez em quando e guarde no iCloud Drive.
- Use sempre o app pelo **ícone da tela inicial**. Abrir pelo Safari normal usa um armazenamento separado.
- Celular e PC não sincronizam sozinhos. Para levar os dados de um para o outro, use backup e restauração.
- Antes de cada restauração, o app guarda uma cópia dos dados anteriores no próprio celular (as 5 últimas).

## Atualizar o app

Se mudar algum arquivo, envie de novo para o repositório e aumente a versão em `sw.js` (`economist-v1` → `economist-v2`). O iPhone baixa a versão nova na próxima abertura com internet.
