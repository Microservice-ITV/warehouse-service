/** Color×size row from product-service product.created / product.updated. */
export interface ProductVariantEventData {
  variant_id?: string;
  sku?: string;
  price?: number;
  base_price?: number;
  stock?: number;
  warehouse_stock_mirror?: number;
  color_id?: string;
  color_code?: string;
  color_name?: string;
  size_id?: string;
  size_code?: string;
  size_name?: string;
  is_primary?: boolean;
}

export interface ProductEventData {
  product_id: string;
  slug?: string;
  title?: string;
  description?: string | null;
  sku?: string;
  price?: number;
  stock?: number;
  currency?: string;
  category_id?: string;
  category_name?: string;
  category_slug?: string;
  parent_category_id?: string | null;
  parent_category_name?: string | null;
  parent_category_slug?: string | null;
  shop_id: string;
  images?: string[];
  image_url?: string | null;
  is_active?: boolean;
  variants?: ProductVariantEventData[];
}

export interface ShopEventData {
  shop_id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  is_active?: boolean;
}

export interface ProductCreatedEvent {
  event_id: string;
  event: 'product.created';
  correlation_id?: string;
  producer?: string;
  data: ProductEventData;
}

export interface ProductUpdatedEvent {
  event_id: string;
  event: 'product.updated';
  correlation_id?: string;
  producer?: string;
  data: ProductEventData;
}

export interface ProductDeletedEvent {
  event_id: string;
  event: 'product.deleted';
  correlation_id?: string;
  producer?: string;
  data: {
    product_id: string;
  };
}

export interface ShopCreatedEvent {
  event_id: string;
  event: 'shop.created';
  correlation_id?: string;
  producer?: string;
  data: ShopEventData;
}

export interface ShopUpdatedEvent {
  event_id: string;
  event: 'shop.updated';
  correlation_id?: string;
  producer?: string;
  data: ShopEventData;
}

export interface ShopDeletedEvent {
  event_id: string;
  event: 'shop.deleted';
  correlation_id?: string;
  producer?: string;
  data: {
    shop_id: string;
  };
}

export interface OrderCreatedEvent {
  event_id: string;
  event: 'order.created';
  correlation_id?: string;
  producer?: string;
  data: {
    order_id?: string | null;
    checkout_id: string;
    expires_at: string;
    items: Array<{
      product_id: string;
      qty: number;
      shop_id: string;
    }>;
  };
}

export interface OrderPaidEvent {
  event_id: string;
  event: 'order.paid';
  correlation_id?: string;
  producer?: string;
  data: {
    order_id?: string;
    checkout_id: string;
    reservation_id?: string;
  };
}

export interface StockConfirmedSaleItem {
  product_id: string;
  variant_id?: string;
  color_id?: string;
  size_id?: string;
  quantity: number;
}

export interface StockConfirmedEvent {
  event_id: string;
  event: 'product.stock.confirmed';
  correlation_id?: string;
  producer?: string;
  data: {
    checkout_id: string;
    reservation_id: string;
    order_id?: string;
    items?: StockConfirmedSaleItem[];
  };
}

export interface OrderCancelledEvent {
  event_id: string;
  event: 'order.cancelled';
  correlation_id?: string;
  producer?: string;
  data: {
    order_id?: string;
    checkout_id: string;
    reservation_id?: string;
  };
}

export interface PurchaseGoodsReceivedData {
  receipt_id: string;
  receipt_number: string;
  purchase_order_id: string;
  warehouse_id: string;
  supplier_id: string | null;
  received_at: string;
  items: Array<{
    product_id: string;
    variant_id?: string;
    quantity: number;
    unit_cost: number;
  }>;
}

export interface PurchaseGoodsReceivedEvent {
  event_id: string;
  event: 'purchase.goods_received';
  correlation_id?: string;
  producer?: string;
  data: PurchaseGoodsReceivedData;
}

export interface PurchaseGoodsReturnedData {
  return_id: string;
  return_number: string;
  warehouse_id: string;
  supplier_id: string;
  returned_at: string;
  items: Array<{
    product_id: string;
    variant_id?: string;
    quantity: number;
    unit_cost: number;
  }>;
}
