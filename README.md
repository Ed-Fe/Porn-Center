# Beter XVideos Acessível

Wrapper local em **Node.js + Express** com frontend em **HTML/CSS/JavaScript puro**, criado sobre a biblioteca [`xvideos-scraper`](https://github.com/lester51/XVideos-Scraper).

## O que ele entrega

- Busca de vídeos com filtros por **ordenação**, **data**, **duração** e **qualidade**.
- **Feed inicial misto** com resultados do **XVideos** e, opcionalmente, do **Pornhub**.
- Navegação por páginas reais:
	- `/` — início / feed
	- `/explore` — busca e exploração
	- `/saved` — vídeos salvos
	- `/view` — player e detalhes de um vídeo
	- `/star` — detalhes de uma estrela e vídeos que ela enviou
- Preferência persistente para **incluir ou não o Pornhub** nas buscas e no feed.
- Cards e página de detalhes mostram a **origem do item** para ficar claro de qual catálogo ele veio.
- Página dedicada para **estrelas específicas**, com detalhes do perfil e lista de vídeos enviados.
- Navegação por **teclado** para percorrer resultados com `↑`, `↓` e abrir detalhes com `Enter`.
- **Paginação** por botões e atalhos com `Alt + ←` e `Alt + →`.
- Página dedicada de **player/detalhes** em `/view`, com troca de qualidade/fonte quando disponível.
- **Favoritos** e **buscas recentes** persistidos no `localStorage` do navegador.
- Interface com foco em **semântica**, contraste, foco visível e regiões com `aria-live`.

## Requisitos

- Node.js 18 ou superior
- npm

## Como rodar

```bash
npm install
npm start
```

Depois abra no navegador:

- `http://localhost:3000`

## Scripts

- `npm start` — sobe o servidor local
- `npm run dev` — modo watch para desenvolvimento
- `npm test` — roda os testes unitários

## Estrutura

- `server.js` — servidor Express, rotas HTML e endpoints locais `/api/feed`, `/api/search`, `/api/video` e `/api/star`
- `src/lib/normalizers.js` — normalização, validação e mistura dos resultados
- `src/lib/xvideos-client.js` — scraping/fallback direto do XVideos
- `src/lib/pornhub-client.js` — scraping direto do Pornhub para feed, busca e detalhe
- `public/` — interface estática acessível
- `tests/` — testes unitários básicos

## Observações

- Os dados do XVideos vêm primeiro da biblioteca base `xvideos-scraper`.
- Como a biblioteca está desatualizada para a busca atual do site, o servidor inclui um **fallback direto** para a página moderna quando a resposta da lib vem vazia.
- Os dados do Pornhub são obtidos por scraping direto no backend e entram no feed/busca apenas quando a preferência **Incluir Pornhub** está ativada.
- O app foi pensado para uso **local**, sem depender de framework frontend.
- Os favoritos e o histórico ficam armazenados apenas no navegador da sua máquina.

## Por que antes não encontrava nada?

- A versão pública de `xvideos-scraper` usa seletores antigos e um fluxo legado de scraping.
- Hoje, a busca real do site responde com HTML diferente o suficiente para a lib retornar lista vazia.
- O backend deste projeto agora detecta esse caso e faz fallback automático com parsing mais resiliente.
