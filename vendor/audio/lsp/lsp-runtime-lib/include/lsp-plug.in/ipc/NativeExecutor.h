/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_IPC_NATIVEEXECUTOR_H_
#define LSP_PLUG_IN_IPC_NATIVEEXECUTOR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/atomic.h>
#include <lsp-plug.in/ipc/Thread.h>
#include <lsp-plug.in/ipc/IExecutor.h>
#include <lsp-plug.in/ipc/ITask.h>

namespace lsp
{
    namespace ipc
    {
        /**
         * Native executor class
         */
        class NativeExecutor: public IExecutor
        {
            private:
                Thread              hThread;
                ITask              *pHead;
                ITask              *pTail;
                atomic_t            nLock;

            private:
                static status_t     execute(void *params);

            private:
                void                run();

            public:
                explicit NativeExecutor();
                NativeExecutor(const NativeExecutor &) = delete;
                NativeExecutor(NativeExecutor &&) = delete;
                virtual ~NativeExecutor() override;

                NativeExecutor &operator = (const NativeExecutor & src) = delete;
                NativeExecutor &operator = (NativeExecutor && src) = delete;

            public:
                /**
                 * Start the execution thread
                 * @return status of operation
                 */
                status_t            start();

            public:
                /**
                 * Submit some task for execution
                 * @param task task to submit
                 * @return true on success
                 */
                virtual bool        submit(ITask *task) override;

                /**
                 * Shutdown the executor
                 */
                virtual void        shutdown() override;
        };
    } /* namespace ipc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IPC_NATIVEEXECUTOR_H_ */
