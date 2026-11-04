# Minecraft Inventory Extractor

Aplicação web em português para análise local de mundos Minecraft Bedrock (.mcworld).

## Estado atual

Esta é uma versão inicial de diagnóstico. Ela abre o pacote e tenta ler valores NBT; a identificação completa das chaves Block Entity, coordenadas e dimensões ainda precisa ser validada com saves reais antes de declarar inventário completo.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Privacidade

O arquivo é processado no navegador e não é enviado para servidor. O projeto não modifica o mundo original.

## Tecnologias

- Vite + React
- mcbe-leveldb-reader
- prismarine-nbt
- SheetJS
