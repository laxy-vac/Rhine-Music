/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 19 сент. 2019 г.
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

#ifndef LSP_PLUG_IN_EXPR_VARIABLES_H_
#define LSP_PLUG_IN_EXPR_VARIABLES_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/expr/Resolver.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace expr
    {
        class Variables: public Resolver
        {
            protected:
                typedef struct variable_t
                {
                    LSPString                   name;
                    value_t                     value;
                } variable_t;

                typedef struct user_func_t
                {
                    LSPString                   name;
                    function_t                  func;
                    void                       *context;
                } user_func_t;

            protected:
                Resolver                   *pResolver;
                lltl::parray<variable_t>    vVars;
                lltl::parray<user_func_t>   vFunc;

            protected:
                status_t            insert_var(const LSPString *name, const value_t *value, size_t idx);
                status_t            insert_var_move(const LSPString *name, value_t *value, size_t idx);
                ssize_t             index_of_var(const LSPString *name);

                status_t            insert_func(const LSPString *name, function_t func, void *context, size_t idx);
                ssize_t             index_of_func(const LSPString *name);

                status_t            set_move(const LSPString *name, value_t *value);

            public:
                explicit Variables();
                explicit Variables(Resolver *r);
                Variables(const Variables &) = delete;
                Variables(Variables &&) = delete;
                virtual ~Variables() override;

                Variables & operator = (const Variables &) = delete;
                Variables & operator = (Variables &&) = delete;

            public:
                virtual status_t    resolve(value_t *value, const char *name, size_t num_indexes = 0, const ssize_t *indexes = NULL) override;
                virtual status_t    resolve(value_t *value, const LSPString *name, size_t num_indexes = 0, const ssize_t *indexes = NULL) override;
                virtual status_t    call(value_t *value, const char *name, size_t num_args, const value_t *args = NULL) override;
                virtual status_t    call(value_t *value, const LSPString *name, size_t num_args, const value_t *args = NULL) override;

            public:
                // Different variable operations
                status_t            set_int(const char *name, ssize_t value);
                status_t            set_float(const char *name, double value);
                status_t            set_bool(const char *name, bool value);
                status_t            set_string(const char *name, const char *value, const char *charset = NULL);
                status_t            set_string(const char *name, const LSPString *value);
                status_t            set_null(const char *name);

                status_t            set_int(const LSPString *name, ssize_t value);
                status_t            set_float(const LSPString *name, double value);
                status_t            set_bool(const LSPString *name, bool value);
                status_t            set_string(const LSPString *name, const char *value, const char *charset = NULL);
                status_t            set_string(const LSPString *name, const LSPString *value);
                status_t            set_null(const LSPString *name);

                status_t            set(const char *name, const value_t *value);
                status_t            set(const LSPString *name, const value_t *value);
                status_t            unset(const char *name, value_t *value = NULL);
                status_t            unset(const LSPString *name, value_t *value = NULL);

                void                clear_vars();

            public:
                status_t            bind_func(const char *name, function_t func, void *context = NULL);
                status_t            bind_func(const LSPString *name, function_t func, void *context = NULL);

                status_t            unbind_func(const char *name);
                status_t            unbind_func(const LSPString *name);

                void                clear_func();

            public:
                void                clear();

            public:
                /**
                 * Get variable resolver
                 * @return variable resolver
                 */
                inline Resolver    *resolver() { return pResolver; }

                /**
                 * Sett variable resolver
                 * @param resolver variable resolver
                 */
                inline void         set_resolver(Resolver *resolver) { pResolver = resolver; }
        };
    
    } /* namespace expr */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_EXPR_VARIABLES_H_ */
