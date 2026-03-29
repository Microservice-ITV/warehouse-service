# Warehouse Service — Event & API Payload Reference

> For developers and technical teams. Use with [warehouse_service_workflow.mmd](./warehouse_service_workflow.mmd).
>
> **Note:** Product catalog (create, edit, browse) and shop management are handled by **Product Service**. See product-service docs for those payloads.

---

## Event envelope (common structure)

All MQ events use this envelope. Warehouse Service uses `event_id`, `event`, `correlation_id`, and `data`.

```json
{
  "event_id": "uuid",
  "event": "event-name",
  "version": "v1",
  "timestamp": "2026-03-18T12:00:00.000Z",
  "producer": "warehouse-service | order-service | product-service",
  "correlation_id": "string",
  "data": { }
}
```

---

## ① Warehouses (REST API)

**POST /api/v1/warehouses — Create warehouse:**
```json
{
  "shopId": "shop-uuid",
  "name": "Main Warehouse",
  "location": "Yangon",
  "isDefault": false
}
```

**GET /api/v1/warehouses?shopId=shop-uuid — List warehouses by shop**

**GET /api/v1/warehouses/:id — Get warehouse by ID**

**PATCH /api/v1/warehouses/:id — Update warehouse:**
```json
{
  "name": "Updated Warehouse Name",
  "location": "Mandalay",
  "status": "ACTIVE"
}
```

---

## ② Inventory Operations (REST API)

**POST /api/v1/inventory/increase — Increase stock:**
```json
{
  "warehouseId": "warehouse-uuid",
  "productId": "product-uuid",
  "quantity": 10,
  "referenceId": "ref-001"
}
```

**POST /api/v1/inventory/adjust — Adjust stock (positive or negative delta):**
```json
{
  "warehouseId": "warehouse-uuid",
  "productId": "product-uuid",
  "quantity": -5,
  "referenceId": "adj-001"
}
```

**POST /api/v1/inventory/transfer — Transfer between warehouses:**
```json
{
  "fromWarehouseId": "warehouse-a-uuid",
  "toWarehouseId": "warehouse-b-uuid",
  "productId": "product-uuid",
  "quantity": 20,
  "referenceId": "transfer-001"
}
```

**POST /api/v1/inventory/count — Stock count (physical count):**
```json
{
  "warehouseId": "warehouse-uuid",
  "productId": "product-uuid",
  "countedQty": 100,
  "referenceId": "count-001"
}
```

**POST /api/v1/inventory/receive — Receive stock (e.g. from PO):**
```json
{
  "warehouseId": "warehouse-uuid",
  "productId": "product-uuid",
  "quantity": 50,
  "referenceType": "PO",
  "referenceId": "po-001"
}
```

**GET /api/v1/inventory/movements?productId=uuid&warehouseId=uuid&limit=50 — List stock movements**

**GET /api/v1/warehouses/:id/inventory — List warehouse inventory**

---

## ③ Stock Validation (Order Service → Warehouse)

Order Service calls `POST /api/v1/products/validate-stock` (service-auth only).

**Request:**
```json
{
  "items": [
    { "product_id": "product-uuid", "qty": 2 },
    { "product_id": "product-uuid-2", "qty": 1 }
  ]
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "stock_validation": true,
    "items": [
      {
        "product_id": "product-uuid",
        "qty": 2,
        "stock_validation": true,
        "reason": "OK",
        "available_stock": 50,
        "unit_price": 99.99,
        "line_total": 199.98,
        "product": {
          "product_id": "product-uuid",
          "slug": "laptop-001",
          "title": "Laptop",
          "sku": "LAP-001",
          "price": 99.99,
          "stock": 50,
          "reserved_stock": 0,
          "available_stock": 50,
          "currency": "USD",
          "category_id": "cat-uuid",
          "shop_id": "shop-uuid",
          "images": [],
          "is_active": true
        }
      }
    ]
  }
}
```

**Response (validation failed):**
```json
{
  "success": true,
  "data": {
    "stock_validation": false,
    "items": [
      {
        "product_id": "product-uuid",
        "qty": 100,
        "stock_validation": false,
        "reason": "OUT_OF_STOCK",
        "available_stock": 10,
        "unit_price": 99.99,
        "line_total": 9999.00,
        "product": { "..." }
      }
    ]
  }
}
```

**Reasons:** `OK`, `OUT_OF_STOCK`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`, `INVALID_QTY`

---

## ④ Order Stock Flows (MQ Events)

### Consumed by Warehouse Service

**order.created (Order Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "order.created",
  "version": "v1",
  "timestamp": "2026-03-18T12:00:00.000Z",
  "producer": "order-service",
  "correlation_id": "checkout-uuid",
  "data": {
    "order_id": "order-uuid",
    "checkout_id": "checkout-uuid",
    "expires_at": "2026-03-18T13:00:00.000Z",
    "items": [
      { "product_id": "product-uuid", "qty": 2, "shop_id": "shop-uuid" }
    ]
  }
}
```

**order.paid (Order Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "order.paid",
  "version": "v1",
  "timestamp": "2026-03-18T12:05:00.000Z",
  "producer": "order-service",
  "correlation_id": "checkout-uuid",
  "data": {
    "order_id": "order-uuid",
    "checkout_id": "checkout-uuid",
    "reservation_id": "reservation-uuid"
  }
}
```

**order.cancelled (Order Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "order.cancelled",
  "version": "v1",
  "timestamp": "2026-03-18T12:10:00.000Z",
  "producer": "order-service",
  "correlation_id": "checkout-uuid",
  "data": {
    "order_id": "order-uuid",
    "checkout_id": "checkout-uuid",
    "reservation_id": "reservation-uuid"
  }
}
```

### Published by Warehouse Service

**stock.reserved (Warehouse Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "stock.reserved",
  "version": "v1",
  "timestamp": "2026-03-18T12:00:01.000Z",
  "producer": "warehouse-service",
  "correlation_id": "checkout-uuid",
  "data": {
    "checkout_id": "checkout-uuid",
    "reservation_id": "reservation-uuid"
  }
}
```

**stock.rejected (Warehouse Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "stock.rejected",
  "version": "v1",
  "timestamp": "2026-03-18T12:00:01.000Z",
  "producer": "warehouse-service",
  "correlation_id": "checkout-uuid",
  "data": {
    "checkout_id": "checkout-uuid",
    "reason": "OUT_OF_STOCK"
  }
}
```

**stock.confirmed (Warehouse Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "stock.confirmed",
  "version": "v1",
  "timestamp": "2026-03-18T12:05:01.000Z",
  "producer": "warehouse-service",
  "correlation_id": "checkout-uuid",
  "data": {
    "checkout_id": "checkout-uuid",
    "reservation_id": "reservation-uuid",
    "order_id": "order-uuid"
  }
}
```

**inventory.updated (Warehouse Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "inventory.updated",
  "version": "v1",
  "timestamp": "2026-03-18T12:00:00.000Z",
  "producer": "warehouse-service",
  "correlation_id": "reference-id",
  "data": {
    "productId": "product-uuid",
    "shopId": "shop-uuid",
    "totalStock": 100,
    "availabilityStatus": "IN_STOCK"
  }
}
```

**inventory.low_stock (Warehouse Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "inventory.low_stock",
  "version": "v1",
  "timestamp": "2026-03-18T12:00:00.000Z",
  "producer": "warehouse-service",
  "correlation_id": "reference-id",
  "data": {
    "product_id": "product-uuid",
    "shop_id": "shop-uuid",
    "warehouse_id": "warehouse-uuid",
    "available_stock": 3,
    "threshold": 5
  }
}
```

---

## ⑤ Sync from Product / Shop (MQ Consumers)

Warehouse Service consumes these events from Product Service to keep product snapshots and default warehouses in sync.

**product.created / product.updated (Product Service → MQ):**
```json
{
  "event_id": "uuid",
  "event": "product.created",
  "producer": "product-service",
  "correlation_id": "product-uuid",
  "data": {
    "product_id": "product-uuid",
    "shop_id": "shop-uuid",
    "stock": 50,
    "sku": "LAP-001",
    "title": "Laptop",
    "description": "...",
    "price": 999.99,
    "currency": "USD",
    "category_id": "cat-uuid",
    "images": [],
    "image_url": "...",
    "is_active": true
  }
}
```

**product.deleted:**
```json
{
  "data": { "product_id": "product-uuid" }
}
```

**shop.created / shop.updated (Product Service → MQ):**
```json
{
  "data": {
    "shop_id": "shop-uuid",
    "name": "Tech Store",
    "slug": "tech-store",
    "description": "...",
    "is_active": true
  }
}
```

**shop.deleted:**
```json
{
  "data": { "shop_id": "shop-uuid" }
}
```

---

## Quick Reference

| Flow | Event / API | Key Fields |
|------|--------------|------------|
| Warehouses | POST /warehouses | `shopId, name, location, isDefault` |
| Warehouses | GET /warehouses?shopId= | `shopId` (query) |
| Warehouses | PATCH /warehouses/:id | `name, location, status` |
| Inventory | POST /inventory/increase | `warehouseId, productId, quantity, referenceId` |
| Inventory | POST /inventory/adjust | `warehouseId, productId, quantity, referenceId` |
| Inventory | POST /inventory/transfer | `fromWarehouseId, toWarehouseId, productId, quantity` |
| Inventory | POST /inventory/count | `warehouseId, productId, countedQty, referenceId` |
| Inventory | POST /inventory/receive | `warehouseId, productId, quantity, referenceType, referenceId` |
| Stock validation | POST /products/validate-stock | `items: [{ product_id, qty }]` |
| Order flow | order.created | `checkout_id, expires_at, items: [{ product_id, qty, shop_id }]` |
| Order flow | order.paid | `checkout_id, reservation_id?, order_id?` |
| Order flow | order.cancelled | `checkout_id, reservation_id?` |
| Order flow | stock.reserved / rejected / confirmed | `checkout_id, reservation_id, reason?` |
| Sync | product.* / shop.* | `product_id, shop_id` (from Product Service) |
