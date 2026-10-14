/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 24 апр. 2024 г.
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

#ifndef LSP_PLUG_IN_IPC_SHAREDMUTEX_H_
#define LSP_PLUG_IN_IPC_SHAREDMUTEX_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/atomic.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/ipc/Thread.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/runtime/system.h>

namespace lsp
{
    namespace ipc
    {
    #if defined(PLATFORM_LINUX) || defined(PLATFORM_FREEBSD)
        #define LSP_ROBUST_MUTEX_SUPPORTED
    #endif /* PLATFORM_LINUX, PLATFORM_FREEBSD */

    #ifdef LSP_ROBUST_MUTEX_SUPPORTED
        struct shared_mutex_t;
    #endif /* LSP_ROBUST_MUTEX_SUPPORTED */

        /**
         * Named global non-recursive shared mutex for inter-process communication.
         * The object tracks it's lock state and automatically unlocks on close().
         * Lock operations can be executed by multiple threads on the same mutex object.
         * Creation and destruction functions are not thread safe.
         */
        class SharedMutex
        {
            private:
        #ifdef PLATFORM_WINDOWS
                typedef void       *HANDLE;

                HANDLE              hLock;
        #else
                int                 hFD;

            #ifdef LSP_ROBUST_MUTEX_SUPPORTED
                shared_mutex_t     *hLock;
            #endif /* LSP_ROBUST_MUTEX_SUPPORTED */
        #endif /* PLATFORM_WINDOWS */
                thread_id_t         nOwner;

            public:
                explicit SharedMutex();
                SharedMutex(const SharedMutex &) = delete;
                SharedMutex(SharedMutex &&) = delete;
                ~SharedMutex();

                SharedMutex & operator = (const SharedMutex &) = delete;
                SharedMutex & operator = (SharedMutex &&) = delete;

            private:
                inline bool         is_opened() const;

                status_t            open_internal(const LSPString *name);

            private:
            #ifndef PLATFORM_WINDOWS
                static status_t     lock_descriptor(int fd, int flags);
                #ifdef LSP_ROBUST_MUTEX_SUPPORTED
                    static status_t     lock_memory(int fd, shared_mutex_t *mutex);
                    static status_t     unlock_memory(int fd, shared_mutex_t *mutex);
                #endif /* LSP_ROBUST_MUTEX_SUPPORTED */
            #endif /* PLATFORM_WINDOWS */

            public:
                /**
                 * Open or create shared mutex object
                 * @param name the UTF-8 encoded name of the shared mutex
                 * @return status of operation
                 */
                status_t            open(const char *name);

                /**
                 * Open or create shared mutex object
                 * @param name the name of the shared mutex
                 * @return status of operation
                 */
                status_t            open(const LSPString *name);

                /**
                 * Close shared mutex object
                 * @return status of operation
                 */
                status_t            close();

                /**
                 * Take a lock on shared mutex.
                 * @return status of operation
                 */
                status_t            lock();

                /**
                 * Try to obtain a lock on shared mutex for the specified period of time
                 * @param delay delay to obtain a lock
                 * @return status of operation
                 */
                status_t            lock(system::time_millis_t delay);

                /**
                 * Try to take a lock on shared mutex.
                 * @return status of operation
                 */
                status_t            try_lock();

                /**
                 * Unlock shared mutex
                 * @return status of operation
                 */
                status_t            unlock();
        };
    } /* namespace ipc */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_IPC_SHAREDMUTEX_H_ */
