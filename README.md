# Cabidino · Loja Infantil

Site da Cabidino, loja de roupas infantis de 1 a 14 anos, hospedado com GitHub + Netlify + Supabase.

## O que tem aqui

- `index.html`: o site completo (vitrine, sacola, guia de tamanhos, jogo "Pula, Dino!")
- `painel.js`: o Painel Cabidino (estoque, cupons, promoções, afiliados, financeiro, equipe, etiquetas)
- `nuvem.js`: liga o site e o painel ao Supabase
- `config.js`: o endereço do projeto Supabase e a chave pública (anon)
- `supabase/`: os arquivos para montar o banco (rodar no SQL Editor do Supabase)
- `fotos/`, `fotos-hd/` e as logos

## Segurança

- Visitantes só conseguem **ler o catálogo**. Pedidos, financeiro, planilhas, afiliados e a equipe
  só abrem para quem está na equipe, logado com e-mail confirmado (regras em `supabase/1-estrutura.sql`).
- A chave do `config.js` é a **anon/publishable**, feita para ficar pública.
  Nunca coloque aqui a chave **service_role/secret** nem a senha do banco.

## Como atualizar

Os arquivos desta pasta são gerados pelo `montar-github.ps1` a partir da pasta `site-cabidino`.
O catálogo (produtos, preços, estoque, textos) muda pelo painel, no botão **Publicar no site**, sem mexer aqui.
