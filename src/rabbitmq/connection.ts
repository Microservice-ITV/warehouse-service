import { connect, type Channel, type ChannelModel } from 'amqplib';
import { rabbitConfig } from '@/config/rabbitmq';
import logger from '@/utils/logger';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const bindConsumerQueue = async (ch: Channel, queue: {
  queue: string;
  routingKey: string;
  dlq: string;
  dlqRoutingKey: string;
}) => {
  await ch.assertQueue(queue.queue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': rabbitConfig.deadLetterExchange,
      'x-dead-letter-routing-key': queue.dlqRoutingKey,
    },
  });
  await ch.assertQueue(queue.dlq, { durable: true });
  await ch.bindQueue(queue.queue, rabbitConfig.exchange, queue.routingKey);
  await ch.bindQueue(queue.dlq, rabbitConfig.deadLetterExchange, queue.dlqRoutingKey);
};

const setupChannel = async (ch: Channel) => {
  await ch.assertExchange(rabbitConfig.exchange, rabbitConfig.exchangeType, { durable: true });
  await ch.assertExchange(rabbitConfig.deadLetterExchange, rabbitConfig.exchangeType, {
    durable: true,
  });

  await bindConsumerQueue(ch, rabbitConfig.consume.productCreated);
  await bindConsumerQueue(ch, rabbitConfig.consume.productUpdated);
  await bindConsumerQueue(ch, rabbitConfig.consume.productDeleted);
  await bindConsumerQueue(ch, rabbitConfig.consume.shopCreated);
  await bindConsumerQueue(ch, rabbitConfig.consume.shopUpdated);
  await bindConsumerQueue(ch, rabbitConfig.consume.shopDeleted);
  await bindConsumerQueue(ch, rabbitConfig.consume.purchaseGoodsReceived);
  await bindConsumerQueue(ch, rabbitConfig.consume.stockConfirmed);

  ch.prefetch(rabbitConfig.prefetch);
};

export const getRabbitChannel = async (): Promise<Channel> => {
  if (channel) return channel;
  const conn = await connect(rabbitConfig.url);
  const ch = await conn.createChannel();

  conn.on('error', (err) => {
    logger.error({ err }, 'RabbitMQ connection error');
  });
  conn.on('close', () => {
    logger.warn('RabbitMQ connection closed');
    connection = null;
    channel = null;
  });
  ch.on('error', (err) => {
    logger.error({ err }, 'RabbitMQ channel error');
  });
  ch.on('close', () => {
    channel = null;
  });

  await setupChannel(ch);

  connection = conn;
  channel = ch;
  logger.info('RabbitMQ connected');
  return ch;
};

export const closeRabbitConnection = async () => {
  if (channel) await channel.close();
  if (connection) await connection.close();
  channel = null;
  connection = null;
};
