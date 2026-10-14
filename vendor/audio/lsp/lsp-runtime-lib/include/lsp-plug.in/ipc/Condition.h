/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 4 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_IPC_CONDITION_H_
#define LSP_PLUG_IN_IPC_CONDITION_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/system.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/atomic.h>

#if defined(PLATFORM_WINDOWS)
    // Nothing
#else
    #include <pthread.h>
#endif

namespace lsp
{
    namespace ipc
    {
#if defined(PLATFORM_WINDOWS)

        namespace detail
        {
            struct condition_t;
        } /* namespace detail */

        /**
         * Condition variable implementation for Windows platform
         */
        class Condition
        {
            private:
                mutable detail::condition_t    *pState;         // Condition variable state

            public:
                explicit Condition();
                Condition(const Condition &) = delete;
                Condition(Condition &&) = delete;
                ~Condition();
                Condition & operator = (const Condition &) = delete;
                Condition & operator = (Condition &&) = delete;

            public:
                /**
                 * Wait until condition mutex is unlocked and lock it
                 */
                bool lock() const;

                /**
                 * Try to lock condition mutex and return status of operation
                 *
                 * @return true if condition has been locked
                 */
                bool try_lock() const;

                /**
                 * Unlock condition mutex
                 * @return true on success
                 */
                bool unlock() const;

                /**
                 * Notify single thread about condition change
                 * @return true on success
                 */
                bool notify() const;

                /**
                 * Notify all waiting threads about condition change
                 * @return true on success
                 */
                bool notify_all() const;

                /**
                 * Wait for condition variable within specified time interval
                 * @param millis time interval to perform the wait
                 * @return status of operation
                 */
                status_t wait(system::time_millis_t millis);

                /**
                 * Perform infinite wait for condition variable
                 * @return status of operation
                 */
                status_t wait();
        };
#else
        /**
         * Condition variable implementation using pthread
         */
        class Condition
        {
            private:
                mutable pthread_mutex_t     sMutex;
                mutable pthread_cond_t      sCondition;

            public:
                explicit Condition();
                Condition(const Condition &) = delete;
                Condition(Condition &&) = delete;
                ~Condition();
                Condition & operator = (const Condition &) = delete;
                Condition & operator = (Condition &&) = delete;

            public:
                /**
                 * Wait until condition mutex is unlocked and lock it
                 */
                bool lock() const;

                /**
                 * Try to lock condition mutex and return status of operation
                 *
                 * @return true if condition has been locked
                 */
                inline bool try_lock() const
                {
                    return pthread_mutex_trylock(&sMutex) == 0;
                }

                /**
                 * Unlock condition mutex
                 * @return true on success
                 */
                inline bool unlock() const
                {
                    return pthread_mutex_unlock(&sMutex) == 0;
                }

                /**
                 * Notify single thread about condition change
                 * @return true on success
                 */
                inline bool notify() const
                {
                    return pthread_cond_signal(&sCondition) == 0;
                }

                /**
                 * Notify all waiting threads about condition change
                 * @return true on success
                 */
                inline bool notify_all() const
                {
                    return pthread_cond_broadcast(&sCondition) == 0;
                }

                /**
                 * Wait for condition variable within specified time interval
                 * @param millis time interval to perform the wait
                 * @return status of operation
                 */
                status_t wait(system::time_millis_t millis);

                /**
                 * Perform infinite wait for condition variable
                 * @return status of operation
                 */
                status_t wait();
        };
#endif

    } /* namespace ipc */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_IPC_CONDITION_H_ */
