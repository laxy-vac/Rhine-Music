/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 27 янв. 2016 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_IPC_IEXECUTOR_H_
#define LSP_PLUG_IN_IPC_IEXECUTOR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/ipc/ITask.h>

namespace lsp
{
    namespace ipc
    {
        class IExecutor
        {
            protected:
                static inline void set_task_state(ITask *task, ITask::task_state_t state)
                {
                    atomic_store(&task->nState, state);
                }

                static inline bool change_task_state(ITask *task, ITask::task_state_t old_state, ITask::task_state_t new_state)
                {
                    return atomic_cas(&task->nState, old_state, new_state);
                }

                static inline void link_task(ITask *tail, ITask *link)
                {
                    tail->pNext     = link;
                    link->pNext     = NULL;
                }

                static inline ITask *unlink_task(ITask *task)
                {
                    ITask *next     = task->pNext;
                    task->pNext     = NULL;
                    return next;
                }

                static inline void set_next_task(ITask *tail, ITask *next)
                {
                    tail->pNext     = next;
                }

                static inline ITask *get_next_task(ITask *task)
                {
                    return task->pNext;
                }

                static inline IExecutor *get_executor(ITask *task)
                {
                    return task->pExecutor;
                }

                static inline void set_executor(ITask *task, IExecutor *executor)
                {
                    task->pExecutor = executor;
                }

                void run_task(ITask *task);

            public:
                IExecutor();
                IExecutor(const IExecutor &) = delete;
                IExecutor(IExecutor &&) = delete;
                virtual ~IExecutor();

                IExecutor &operator = (const IExecutor & src) = delete;
                IExecutor &operator = (IExecutor && src) = delete;

            protected:
                virtual void task_finished(ITask *task);

            public:
                /** Submit task for execution
                 *
                 * @param task task to execute
                 * @return true if task was submitted
                 */
                virtual bool submit(ITask *task);

                /** Shutdown executor service
                 * The method must return only when all tasks
                 * have been completed or terminated
                 *
                 */
                virtual void shutdown();
        };

    } /* namespace ipc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IPC_IEXECUTOR_H_ */
