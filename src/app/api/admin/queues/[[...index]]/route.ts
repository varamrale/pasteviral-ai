import { createBullBoardApp } from '@/lib/bull-board'

const app = createBullBoardApp()

export const GET = app.fetch
export const POST = app.fetch
