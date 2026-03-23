/**
 * KafkaClient abstraction — allows swapping kafkajs for @confluentinc/kafka-javascript
 * (or any other Kafka client) without touching consuming code.
 */

export interface KafkaClientConfig {
  clientId: string;
  brokers: string[];
  ssl?: boolean;
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
}

export interface KafkaConsumerConfig {
  groupId: string;
}

export interface KafkaMessage {
  value: Buffer | null;
  key: Buffer | null;
  headers?: Record<string, Buffer | string | undefined>;
  offset: string;
  timestamp: string;
}

export interface KafkaConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(config: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(config: {
    eachMessage: (payload: { message: KafkaMessage }) => Promise<void>;
  }): Promise<void>;
}

export interface KafkaProducerMessage {
  topic: string;
  key?: string;
  value: string;
}

export interface KafkaProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: KafkaProducerMessage): Promise<void>;
}

export interface KafkaClient {
  consumer(config: KafkaConsumerConfig): KafkaConsumer;
  producer(): KafkaProducer;
}
