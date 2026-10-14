/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 25 февр. 2019 г.
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

#ifndef LSP_PLUG_IN_IPC_MUTEX_H_
#define LSP_PLUG_IN_IPC_MUTEX_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/atomic.h>

#if defined(PLATFORM_WINDOWS)
    // Nothing
#elif defined(PLATFORM_LINUX)
    #include <linux/futex.h>
    #include <sys/syscall.h>
    #include <unistd.h>
    #include <pthread.h>
    #include <sched.h>
    #include <errno.h>
#else
    #include <pthread.h>
    #include <sched.h>
    #include <errno.h>
#endif

namespace lsp
{
    namespace ipc
    {
#if defined(PLATFORM_WINDOWS)

        namespace detail
        {
            struct CRITICAL_SECTION;
        } /* namespace detail */

        /**
         * Recursive mutex for Windows platform
         */
        class Mutex
        {
            private:
                mutable detail::CRITICAL_SECTION   *hMutex;     // Mutex object

            public:
                explicit Mutex();
                Mutex(const Mutex &) = delete;
                Mutex(Mutex &&) = delete;
                ~Mutex();
                Mutex & operator = (const Mutex &) = delete;
                Mutex & operator = (Mutex &&) = delete;

                /** Wait until mutex is unlocked and lock it
                 *
                 */
                bool lock() const;

                /** Try to lock mutex and return status of operation
                 *
                 * @return non-zero value if mutex was locked
                 */
                bool try_lock() const;

                /** Unlock mutex
                 *
                 */
                bool unlock() const;
        };
#elif defined(PLATFORM_LINUX)
        /**
         * Fast recursive mutex implementation for Linux using Futex primitive
         */
        class Mutex
        {
            private:
                mutable int                     nLock;      // 1 = unlocked, 0 = locked
                mutable volatile pthread_t      nThreadId;  // Locked thread identifier
                mutable ssize_t                 nLocks;     // Number of locks by current thread

            public:
                explicit Mutex()
                {
                    nLock       = 1;
                    nThreadId   = -1;
                    nLocks      = 0;
                }

                Mutex(const Mutex &) = delete;
                Mutex(Mutex &&) = delete;
                ~Mutex() = default;

                Mutex & operator = (const Mutex &) = delete;
                Mutex & operator = (Mutex &&) = delete;


                /** Wait until mutex is unlocked and lock it
                 *
                 */
                bool lock() const;

                /** Try to lock mutex and return status of operation
                 *
                 * @return non-zero value if mutex was locked
                 */
                bool try_lock() const;

                /** Unlock mutex
                 *
                 */
                bool unlock() const;
        };
#else
        /**
         * Recursive mutex implementation using pthread
         */
        class Mutex
        {
            private:
                mutable pthread_mutex_t     sMutex;

            public:
                explicit Mutex();
                Mutex(const Mutex &) = delete;
                Mutex(Mutex &&) = delete;
                ~Mutex();
                Mutex & operator = (const Mutex &) = delete;
                Mutex & operator = (Mutex &&) = delete;

                /** Wait until mutex is unlocked and lock it
                 *
                 */
                inline bool lock() const
                {
                    while (true)
                    {
                        switch (pthread_mutex_lock(&sMutex))
                        {
                            case 0: return true;
                            case EBUSY:
                                sched_yield();
                                break;
                            default: return false;
                        }
                    }
                }

                /** Try to lock mutex and return status of operation
                 *
                 * @return non-zero value if mutex was locked
                 */
                inline bool try_lock() const
                {
                    return pthread_mutex_trylock(&sMutex) == 0;
                }

                /** Unlock mutex
                 *
                 */
                inline bool unlock() const
                {
                    return pthread_mutex_unlock(&sMutex) == 0;
                }
        };
#endif
    
    } /* namespace ipc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IPC_MUTEX_H_ */
