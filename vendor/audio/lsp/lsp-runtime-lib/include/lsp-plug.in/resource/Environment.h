/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 26 окт. 2020 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_ENVIRONMENT_H_
#define LSP_PLUG_IN_RESOURCE_ENVIRONMENT_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/lltl/pphash.h>

namespace lsp
{
    namespace resource
    {
        /**
         * Key-value environment variables (adaptor around lltl::pphash)
         */
        class Environment
        {
            private:
                Environment &operator = (const Environment &);
                Environment(const Environment &);

            protected:
                lltl::pphash<LSPString, LSPString>  vEnv;

            public:
                explicit Environment();
                ~Environment();

            public:
                const LSPString *get(const char *key) const;
                const LSPString *get(const LSPString *key) const;
                const LSPString *get(const LSPString *key, const LSPString *dfl) const;

                const char      *get_utf8(const char *key) const;
                const char      *get_utf8(const char *key, const char *dfl) const;
                const char      *get_utf8(const LSPString *key) const;

                bool            contains(const char *key) const;
                bool            contains(const LSPString *key) const;

                status_t        set(const char *key, const char *value);
                status_t        set(const char *key, const LSPString *value);
                status_t        set(const LSPString *key, const char *value);
                status_t        set(const LSPString *key, const LSPString *value);

                status_t        remove(const char *key);
                status_t        remove(const LSPString *key);

                Environment    *clone();
        };
    }
}


#endif /* LSP_PLUG_IN_RESOURCE_ENVIRONMENT_H_ */
