/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 сент. 2019 г.
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

#ifndef LSP_PLUG_IN_EXPR_RESOLVER_H_
#define LSP_PLUG_IN_EXPR_RESOLVER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/expr/types.h>
#include <lsp-plug.in/expr/functions.h>

namespace lsp
{
    namespace expr
    {
        /**
         * This is a class that resolves the actual value by the variable name.
         * By default, it resolves all values as NULLs
         *
         */
        class Resolver
        {
            public:
                explicit Resolver();
                Resolver(const Resolver &) = delete;
                Resolver(Resolver &&) = delete;
                virtual ~Resolver();

                Resolver & operator = (const Resolver &) = delete;
                Resolver & operator = (Resolver &&) = delete;

            protected:
                stdfunc_t find_std_func(const char *name);

            public:
                /**
                 * Resolve array variable by name and indexes
                 * @param value pointer to value to store the data
                 * @param name array variable name
                 * @param num_indexes number of indexes in array
                 * @param indexes pointer to array containing all index values
                 * @return status of operation
                 */
                virtual status_t resolve(value_t *value, const char *name, size_t num_indexes = 0, const ssize_t *indexes = NULL);

                /**
                 * Resolve array variable by name and indexes
                 * @param value pointer to value to store the data
                 * @param name array variable name
                 * @param num_indexes number of indexes in array
                 * @param indexes pointer to array containing all index values
                 * @return status of operation
                 */
                virtual status_t resolve(value_t *value, const LSPString *name, size_t num_indexes = 0, const ssize_t *indexes = NULL);

                /**
                 * Perform function call
                 * @param value destination pointer to store the value
                 * @param name name of the function
                 * @param num_args number of arguments
                 * @param args list of arguments (may be NULL)
                 * @return status of operation
                 */
                virtual status_t call(value_t *value, const char *name, size_t num_args, const value_t *args = NULL);

                /**
                 * Perform function call
                 * @param value destination pointer to store the value
                 * @param name name of the function
                 * @param num_args number of arguments
                 * @param args list of arguments (may be NULL)
                 * @return status of operation
                 */
                virtual status_t call(value_t *value, const LSPString *name, size_t num_args, const value_t *args = NULL);
        };
    
    } /* namespace expr */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_EXPR_RESOLVER_H_ */
