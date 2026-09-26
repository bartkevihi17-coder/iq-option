# IQ Option Assistant

Desktop app em Electron inspirado no visual do Auto-Future.

## Recursos do MVP
- feed ao vivo por WebSocket para ativos suportados pela Binance;
- busca/troca rápida de ativo;
- gráfico em tempo real com EMA 9 e EMA 21;
- RSI 14, velocidade, distância e ETA aproximado até a meta;
- regras de compra/venda por preço-alvo com pré-alerta;
- notificação nativa do Windows;
- detecção de aproximação, confirmação de tendência e possível rejeição;
- streaming de screenshot da tela principal para a VPS a cada 1 segundo;
- buffer remoto circular limitado às 10 imagens mais recentes.

## Executar
1. `npm install`
2. Crie `settings.local.json` com `vpsEndpoint` e `vpsToken`.
3. `npm start`

A integração direta com IQ Option deve ser tratada como experimental porque os wrappers disponíveis são comunitários/não oficiais. O app foi desenhado com a fonte de dados desacoplada para permitir trocar o provider depois.
