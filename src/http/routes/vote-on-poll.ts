import { z } from "zod"
import { randomUUID } from "node:crypto"
import { FastifyInstance } from "fastify"

import { prisma } from "../../lib/prisma"
import { redis } from "../../lib/redis"
import { voting } from "../../utils/voting-pub-sub"

export async function voteOnPoll(app: FastifyInstance) {
  app.post("/polls/:pollId/votes", async (request, reply) => {
    const votePollParams = z.object({
      pollId: z.string().uuid(),
    })
    const votePollBody = z.object({
      pollOptionId: z.string().uuid(),
    })

    const { pollId } = votePollParams.parse(request.params)
    const { pollOptionId } = votePollBody.parse(request.body)

    let { sessionId } = request.cookies

    if (sessionId) {
      const userHadPreviousVote = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            sessionId,
            pollId,
          },
        },
      })

      if (userHadPreviousVote) {
        if (userHadPreviousVote.pollOptionId !== pollOptionId) {
          await prisma.vote.delete({
            where: {
              id: userHadPreviousVote.id,
            },
          })

          const votes = await redis.zincrby(
            pollId,
            -1,
            userHadPreviousVote.pollOptionId
          )

          voting.publish(pollId, {
            pollOptionId: userHadPreviousVote.pollOptionId,
            votes: Number(votes),
          })
        } else {
          return reply
            .status(400)
            .send("User had already voted with this option!")
        }
      }
    }

    if (!sessionId) {
      sessionId = randomUUID()

      reply.setCookie("sessionId", sessionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true,
        httpOnly: true,
      })
    }

    await prisma.vote.create({
      data: {
        sessionId,
        pollId,
        pollOptionId,
      },
    })

    const votes = await redis.zincrby(pollId, 1, pollOptionId)

    voting.publish(pollId, {
      pollOptionId,
      votes: Number(votes),
    })

    return reply.status(201).send()
  })
}
