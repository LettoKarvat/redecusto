# React Barcode Scanner App

Este projeto demonstra uma aplicação web para consulta de produtos através de leitura de códigos de barras e QR Codes usando a câmera do dispositivo. O aplicativo foi refatorado e otimizado a partir de um código original mais complexo, mantendo as mesmas funcionalidades básicas e chamadas de API.

## Funcionalidades

- **Leitura automática de códigos**: Utiliza a API nativa `BarcodeDetector` quando disponível (Modo Ultra) e cai para ZXing (`@zxing/browser` e `@zxing/library`) como fallback.
- **Consulta de produto**: Ao detectar um código, realiza uma chamada para a API configurada (`/test-api/product/details`) e exibe as informações retornadas.
- **Entrada manual**: Permite digitar manualmente um código de produto para consulta.
- **Configurações protegidas por senha**: Permite ajustar a URL da API, filial e região, exigindo uma senha definida no código.
- **Suporte a flash e zoom**: Quando suportado pela câmera, é possível ligar/desligar a lanterna e ajustar o zoom.

## Pré-requisitos

Para rodar o projeto localmente você precisa ter o Node.js e npm (ou yarn) instalados.

## Instalação

1. Clone este repositório ou copie os arquivos do diretório `react-barcode-app`.
2. No terminal, navegue até a pasta `react-barcode-app`.
3. Instale as dependências:

```bash
npm install
```

4. Inicie o ambiente de desenvolvimento:

```bash
npm run dev
```

O Vite informará em qual URL a aplicação estará acessível (por padrão, `http://localhost:5173`).

## Construção para produção

Para gerar uma build otimizada para produção:

```bash
npm run build
```

Os arquivos serão gerados na pasta `dist`.

## Observações

- O acesso à câmera no navegador requer que o site seja servido via HTTPS ou localhost.
- A API utilizada (`/test-api/product/details`) deve estar acessível conforme a configuração no modal de configurações.
- Algumas funcionalidades, como a detecção de códigos via `BarcodeDetector`, dependem do suporte do navegador e dispositivo.

## Licença

Este projeto é disponibilizado "como está" para fins educacionais. Use e modifique conforme necessário para o seu caso de uso.