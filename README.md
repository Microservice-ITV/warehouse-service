# Warehouse Service

Warehouse Service is the inventory domain service for the ecommerce microservice platform.

## Responsibilities

- Manage warehouses
- Manage inventory per warehouse/product
- Reserve stock on `order.created`
- Confirm stock on `order.paid`
- Release stock on `order.cancelled`
- Record stock movements
- Publish inventory projections to read model

## Stack

- Node.js + TypeScript
- Express
- Prisma + PostgreSQL
- RabbitMQ
- Zod validation
- Pino logging

## Folder Structure

```text
src/
  controllers/
  services/
  repositories/
  events/
  consumers/
  publishers/
  validators/
  config/
  rabbitmq/
  middleware/
  routes/
  utils/
prisma/
```

## REST APIs

- `POST /api/v1/warehouses`
- `GET /api/v1/warehouses/:id/inventory`
- `POST /api/v1/inventory/increase`
- `POST /api/v1/inventory/adjust`
- `GET /api/v1/inventory/movements`

## Consumed Events

- `product.created`
- `order.created`
- `order.paid`
- `order.cancelled`

## Produced Events

- `stock.reserved`
- `stock.rejected`
- `stock.confirmed`
- `inventory.updated`

`inventory.updated` payload:

```json
{
  "productId": "uuid",
  "shopId": "uuid",
  "totalStock": 200,
  "availabilityStatus": "IN_STOCK"
}
```

## Idempotency

Inbound message processing uses `inbox_events`:

- Track received events
- Skip already processed `event_id`
- Mark processed/failed with attempts

## Reservation Concurrency Safety

Reservation flow uses PostgreSQL row-level locking:

- `SELECT ... FOR UPDATE` on inventory rows
- Inventory updates inside a single Prisma transaction
- Prevents overselling under concurrent orders

## Local Setup

1. Copy env:

```bash
cp env.example .env
```

2. Install:

```bash
npm install
```

3. Generate Prisma client:

```bash
npm run prisma:generate
```

4. Run migrations:

```bash
npm run prisma:migrate
```

5. Start service:

```bash
npm run dev
```
