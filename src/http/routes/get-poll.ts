import { z } from "zod"
import { FastifyInstance } from "fastify"

import { prisma } from "../../lib/prisma"
import { redis } from "../../lib/redis"

export async function getPoll(app: FastifyInstance) {
  app.get("/poll/:pollId", async (request, reply) => {
    const createPollBody = z.object({
      pollId: z.string().uuid(),
    })

    const { pollId } = createPollBody.parse(request.params)

    const poll = await prisma.poll.findUnique({
      where: {
        id: pollId,
      },
      include: {
        options: {
          select: {
            title: true,
            id: true,
          },
        },
      },
    })

    if (!poll) {
      return reply.status(400).send("Poll not found")
    }

    const result = await redis.zrange(pollId, 0, -1, "WITHSCORES")

    console.log({ result })

    const votes = result.reduce((obj, line, idx) => {
      if (idx % 2 === 0) {
        const score = result[idx + 1]
        Object.assign(obj, { [line]: Number(score) })
      }
      return obj
    }, {} as Record<string, number>)

    return reply.send({
      poll: {
        id: poll.id,
        title: poll.title,
        options: poll.options.map((option) => ({
          ...option,
          score: option.id in votes ? votes[option.id] : 0,
        })),
      },
    })
  })
}
