/**
 * KafkaClient implementation backed by @confluentinc/kafka-javascript.
 *
 * This uses the KafkaJS compatibility layer that the Confluent package exposes,
 * which under the hood wraps librdkafka (C++ native bindings).
 *
 * The dynamic import ensures the native module is only loaded when actually
 * creating a client — avoiding bundling/startup issues in tests or environments
 * where the native addon is not installed.
 */

import type {
  KafkaClient,
  KafkaClientConfig,
  KafkaConsumer,
  KafkaConsumerConfig,
  KafkaMessage,
  KafkaProducer,
  KafkaProducerMessage,
} from "./kafka-types.js";

export function createConfluentKafkaClient(config: KafkaClientConfig): KafkaClient {
  return {
    consumer(consumerConfig: KafkaConsumerConfig): KafkaConsumer {
      // The actual Confluent consumer is lazily created inside connect().
      let consumer: any = null;

      return {
        async connect() {
          const { KafkaJS } = await import("@confluentinc/kafka-javascript");
          const kafka = new KafkaJS.Kafka({
            kafkaJS: {
              brokers: config.brokers,
              clientId: config.clientId,
              ssl: config.ssl,
              sasl: config.sasl,
            },
          });
          consumer = kafka.consumer({
            kafkaJS: { groupId: consumerConfig.groupId },
          });
          await consumer.connect();
        },

        async disconnect() {
          if (consumer) await consumer.disconnect();
        },

        async subscribe(subConfig) {
          if (!consumer) throw new Error("Consumer not connected");
          await consumer.subscribe({
            topics: [subConfig.topic],
            fromBeginning: subConfig.fromBeginning,
          });
        },

        async run(runConfig) {
          if (!consumer) throw new Error("Consumer not connected");
          await consumer.run({
            eachMessage: async ({ message }: any) => {
              const wrapped: KafkaMessage = {
                value: message.value,
                key: message.key,
                headers: message.headers,
                offset: String(message.offset),
                timestamp: String(message.timestamp),
              };
              await runConfig.eachMessage({ message: wrapped });
            },
          });
        },
      };
    },

    producer(): KafkaProducer {
      let producer: any = null;

      return {
        async connect() {
          const { KafkaJS } = await import("@confluentinc/kafka-javascript");
          const kafka = new KafkaJS.Kafka({
            kafkaJS: {
              brokers: config.brokers,
              clientId: config.clientId,
              ssl: config.ssl,
              sasl: config.sasl,
            },
          });
          producer = kafka.producer();
          await producer.connect();
        },

        async disconnect() {
          if (producer) await producer.disconnect();
        },

        async send(message: KafkaProducerMessage) {
          if (!producer) throw new Error("Producer not connected");
          await producer.send({
            topic: message.topic,
            messages: [
              {
                key: message.key,
                value: message.value,
              },
            ],
          });
        },
      };
    },
  };
}
